use crate::{model::*, service::Service};
use anyhow::{Context, Result, ensure};
use playit_agent_core::{
    agent_control::{AuthApi, DualStackUdpSocket, maintained_control::MaintainedControl},
    network::{
        origin_lookup::{OriginIp, OriginLookup, OriginResource, OriginTarget},
        tcp::tcp_settings::TcpSettings,
        udp::udp_settings::UdpSettings,
    },
    playit_agent::{PlayitAgent, PlayitAgentSettings},
};
use playit_api_client::{
    PlayitApi,
    api::{ClaimAgentType, ClaimSetupResponse, ReqClaimExchange, ReqClaimSetup},
};
use std::{
    future::Future,
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use tokio_util::sync::CancellationToken;
const API: &str = "https://api.playit.gg";
const REGISTRATION_RETRY: &str = "Playit could not register this device. Check your connection and firewall, then choose Check connection. Your account is still linked.";

async fn register_agent(secret: String) -> Result<()> {
    // Claiming a key alone leaves agent_version/schema_id unset in Playit.
    // Use the upstream handshake to advertise its actual version and platform.
    // Only a temporary control socket exists here: no TCP/UDP forwarder or
    // Minecraft process is created, and dropping the control closes the socket.
    let io = DualStackUdpSocket::new()
        .await
        .map_err(|_| anyhow::anyhow!(REGISTRATION_RETRY))?;
    let auth = AuthApi::new(API.into(), secret);
    let _control = MaintainedControl::setup(io, auth)
        .await
        .map_err(|_| anyhow::anyhow!(REGISTRATION_RETRY))?;
    Ok(())
}

fn key() -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(
        "io.github.buggyguys.enderlink",
        "playit-agent",
    )?)
}
impl Service {
    /// Full reset must also forget a stored key that could not be loaded at startup.
    pub(crate) fn forget_provider_authorization(&self) -> Result<()> {
        self.disconnect_provider()?;
        #[cfg(not(test))]
        match key()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(anyhow::anyhow!(error).context(
                "Could not clear saved Playit authorization. Unlock your credential store and retry. No world files have been deleted."
            )),
        }
        Ok(())
    }
    pub fn load_provider_secret(&self) {
        let epoch = self.provider_epoch.load(Ordering::SeqCst);
        if epoch != 0 {
            return;
        }
        self.provider_for(epoch, |provider| {
            provider.state = "loadingAuthorization".into()
        });
        let loaded = key().and_then(|entry| match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.into()),
        });
        self.finish_loading_secret(epoch, loaded);
    }
    fn finish_loading_secret(&self, epoch: u64, loaded: Result<Option<String>>) {
        // A pending OS permission prompt must not block linking, disconnecting,
        // or resetting. Never restore its stale result after one of those actions.
        let _auth = self.provider_auth.lock().unwrap();
        if self.provider_epoch.load(Ordering::SeqCst) != epoch {
            return;
        }
        let mut provider = self.provider.lock().unwrap();
        match loaded {
            Ok(Some(secret)) => {
                *self.secret.lock().unwrap() = Some(secret);
                provider.linked = true;
                provider.persisted = true;
                provider.state = "standby".into();
                provider.error = None;
            }
            result => {
                provider.state = "disconnected".into();
                provider.error = result.err().map(|_| "Saved Playit authorization is unavailable. Unlock your credential store, or link again.".into());
            }
        }
    }
    fn provider_for(&self, epoch: u64, f: impl FnOnce(&mut ProviderView)) {
        let mut p = self.provider.lock().unwrap();
        if self.provider_epoch.load(Ordering::SeqCst) == epoch {
            f(&mut p)
        }
    }
    fn next_provider_epoch(&self) -> u64 {
        // Serialize invalidation with installing the setup probe's token. A
        // disconnect or hosting start must cancel even a just-starting probe.
        let mut registration = self.provider_registration.lock().unwrap();
        let epoch = self.provider_epoch.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some(token) = registration.take() {
            token.cancel();
        }
        epoch
    }
    pub async fn begin_link(&self, remember: bool) -> Result<String> {
        ensure!(
            self.provider_cancel.lock().unwrap().is_none(),
            "Stop hosting before changing provider authorization."
        );
        if let Some(t) = self.claim_cancel.lock().unwrap().take() {
            t.cancel()
        }
        ensure!(
            self.secret.lock().unwrap().is_none(),
            "Disconnect the existing provider account before linking another one."
        );
        let code = hex::encode(rand::random::<[u8; 5]>());
        let api = PlayitApi::create(API.into(), None);
        tokio::time::timeout(
            Duration::from_secs(15),
            api.claim_setup(ReqClaimSetup {
                code: code.clone(),
                agent_type: ClaimAgentType::Assignable,
                version: concat!("Enderlink ", env!("CARGO_PKG_VERSION")).into(),
            }),
        )
        .await
        .context("Provider setup timed out")?
        .map_err(|_| anyhow::anyhow!("Playit setup could not start. Try again later."))?;
        let url = format!("https://playit.gg/claim/{code}");
        let epoch = self.next_provider_epoch();
        self.provider_for(epoch, |p| {
            p.state = "awaitingApproval".into();
            p.claim_url = Some(url.clone());
            p.error = None;
        });
        let token = CancellationToken::new();
        *self.claim_cancel.lock().unwrap() = Some(token.clone());
        let svc = self.clone();
        tokio::spawn(async move {
            let result = svc.poll_claim(api, code, remember, token, epoch).await;
            if let Err(e) = result {
                svc.provider_for(epoch, |p| {
                    p.state = "disconnected".into();
                    p.claim_url = None;
                    p.error = Some(e.to_string());
                });
            }
        });
        Ok(url)
    }
    async fn poll_claim(
        &self,
        api: PlayitApi,
        code: String,
        remember: bool,
        token: CancellationToken,
        epoch: u64,
    ) -> Result<()> {
        for _ in 0..120 {
            tokio::select! {
                _=token.cancelled()=>return Ok(()),
                _=tokio::time::sleep(Duration::from_secs(3))=>{}
            }
            let setup = tokio::select! {
                _=token.cancelled()=>return Ok(()),
                response=tokio::time::timeout(Duration::from_secs(12),api.claim_setup(ReqClaimSetup{code:code.clone(),agent_type:ClaimAgentType::Assignable,version:concat!("Enderlink ", env!("CARGO_PKG_VERSION")).into()}))=>response.context("Provider did not respond")?.map_err(|_|anyhow::anyhow!("Provider claim expired. Start setup again."))?
            };
            match setup {
                ClaimSetupResponse::UserRejected => {
                    anyhow::bail!("Provider authorization was declined.")
                }
                ClaimSetupResponse::UserAccepted => {
                    let response = tokio::time::timeout(
                        Duration::from_secs(15),
                        api.claim_exchange(ReqClaimExchange { code: code.clone() }),
                    )
                    .await?
                    .map_err(|_| {
                        anyhow::anyhow!("Provider authorization could not be completed.")
                    })?;
                    {
                        // Serialize secret persistence with disconnect; canceled claims cannot relink.
                        let _auth = self.provider_auth.lock().unwrap();
                        if token.is_cancelled()
                            || self.provider_epoch.load(Ordering::SeqCst) != epoch
                        {
                            return Ok(());
                        }
                        let stored = remember
                            && key()
                                .and_then(|k| Ok(k.set_password(&response.secret_key)?))
                                .is_ok();
                        *self.secret.lock().unwrap() = Some(response.secret_key);
                        self.provider_for(epoch, |p| {
                            p.linked = true;
                            p.persisted = stored;
                            p.state = "standby".into();
                            p.claim_url = None;
                            p.error = if remember && !stored {
                                Some(
                                "Credential store unavailable. Linked for this app session only."
                                    .into(),
                            )
                            } else {
                                None
                            };
                        });
                        let port = self
                            .session
                            .lock()
                            .unwrap()
                            .as_ref()
                            .filter(|s| s.pid.is_some())
                            .and_then(|s| self.world(&s.world_id).ok())
                            .map(|w| w.port);
                        if let Some(port) = port {
                            self.start_provider(port);
                        }
                    }
                    // Finish registration even if the user leaves Settings.
                    // A network failure here keeps the account linked for retry.
                    let _ = self.verify_provider().await;
                    return Ok(());
                }
                _ => {}
            }
        }
        anyhow::bail!("Provider setup expired. Start again when ready.")
    }
    pub fn disconnect_provider(&self) -> Result<()> {
        let _auth = self.provider_auth.lock().unwrap();
        self.next_provider_epoch();
        if let Some(t) = self.claim_cancel.lock().unwrap().take() {
            t.cancel()
        }
        self.stop_provider();
        let persisted = self.provider.lock().unwrap().persisted;
        if persisted {
            key()?.delete_credential().context(
                "Could not remove the saved credential. Unlock your credential store and retry.",
            )?;
        }
        self.mutate(|d| {
            d.provider_setup = ProviderSetup::default();
            Ok(())
        })?;
        *self.secret.lock().unwrap() = None;
        *self.provider.lock().unwrap() = ProviderView {
            state: "disconnected".into(),
            ..Default::default()
        };
        Ok(())
    }
    async fn refresh_origins(
        &self,
        api: &PlayitApi,
        lookup: &OriginLookup,
        port: u16,
        epoch: u64,
    ) -> Result<()> {
        let data = tokio::time::timeout(Duration::from_secs(15), api.v1_agents_rundata())
            .await?
            .map_err(|_| {
                anyhow::anyhow!("Cannot load Playit tunnels. Check the linked account.")
            })?;
        let mut resources = vec![];
        let mut endpoints = vec![];
        for tunnel in &data.tunnels {
            if tunnel.disabled_reason.is_some()
                || !tunnel
                    .tunnel_type
                    .as_deref()
                    .unwrap_or("")
                    .starts_with("minecraft-java")
            {
                continue;
            }
            if let Some(mut resource) = OriginResource::from_agent_tunnel(tunnel) {
                resource.target = OriginTarget::Port {
                    ip: OriginIp::IpAddress(std::net::Ipv4Addr::LOCALHOST.into()),
                    port,
                };
                resources.push(resource);
                endpoints.push(tunnel.display_address.clone());
            }
        }
        self.observe_tunnels(epoch, !endpoints.is_empty())?;
        lookup.update(resources.into_iter()).await;
        self.provider_for(epoch,|p|{p.endpoints=endpoints;p.error=if p.endpoints.is_empty(){Some("Create a free Minecraft Java tunnel for this agent in the Playit dashboard. This app checks for it automatically.".into())}else{None};});
        Ok(())
    }
    fn observe_tunnels(&self, epoch: u64, configured: bool) -> Result<()> {
        let _auth = self.provider_auth.lock().unwrap();
        if self.provider_epoch.load(Ordering::SeqCst) != epoch {
            return Ok(());
        }
        self.mutate(|d| {
            d.provider_setup = ProviderSetup {
                tunnel_configured: configured,
                checked_at: Some(now()),
            };
            Ok(())
        })?;
        Ok(())
    }
    async fn prepare_provider(
        &self,
        epoch: u64,
        registration: impl Future<Output = Result<()>>,
    ) -> Result<bool> {
        let token = CancellationToken::new();
        {
            let mut slot = self.provider_registration.lock().unwrap();
            if self.provider_epoch.load(Ordering::SeqCst) != epoch {
                return Ok(false);
            }
            if self.provider.lock().unwrap().agent_registered
                || self.provider_cancel.lock().unwrap().is_some()
            {
                // An active hosting agent performs its own handshake. A second
                // registration must not replace its live control connection.
                return Ok(true);
            }
            *slot = Some(token.clone());
        }
        self.provider_for(epoch, |p| {
            p.state = "registering".into();
            p.error = None;
        });
        let result = tokio::select! {
            biased;
            _ = token.cancelled() => return Ok(false),
            result = tokio::time::timeout(Duration::from_secs(45), registration) =>
                result.map_err(|_| anyhow::anyhow!(REGISTRATION_RETRY)).and_then(|r| r),
        };
        {
            let mut slot = self.provider_registration.lock().unwrap();
            if self.provider_epoch.load(Ordering::SeqCst) != epoch || token.is_cancelled() {
                return Ok(false);
            }
            slot.take();
        }
        match result {
            Ok(()) => {
                self.provider_for(epoch, |p| {
                    p.agent_registered = true;
                    p.state = "standby".into();
                    p.error = None;
                });
                Ok(true)
            }
            Err(error) => {
                self.provider_for(epoch, |p| {
                    p.state = "registrationFailed".into();
                    p.error = Some(error.to_string());
                });
                Err(error)
            }
        }
    }
    pub async fn verify_provider(&self) -> Result<()> {
        // The claim completion and Settings can both request a check. Keep a
        // single setup handshake in flight and reuse its successful result.
        let _check = self.provider_check.lock().await;
        // Capture authorization and its generation together: a disconnect/relink
        // must not let an old account's response update a new account's setup.
        let (secret, epoch) = {
            let _auth = self.provider_auth.lock().unwrap();
            let secret = self
                .secret
                .lock()
                .unwrap()
                .clone()
                .context("Link Playit before checking the tunnel.")?;
            (secret, self.provider_epoch.load(Ordering::SeqCst))
        };
        if !self
            .prepare_provider(epoch, register_agent(secret.clone()))
            .await?
        {
            return Ok(());
        }
        let api = PlayitApi::create(API.into(), Some(secret));
        let response = tokio::time::timeout(Duration::from_secs(15), api.v1_agents_rundata()).await;
        match response {
            Ok(Ok(data)) => {
                let configured = data.tunnels.iter().any(|t| {
                    t.disabled_reason.is_none()
                        && t.tunnel_type
                            .as_deref()
                            .unwrap_or("")
                            .starts_with("minecraft-java")
                });
                self.observe_tunnels(epoch, configured)?;
                // No tunnel yet is a normal setup step, not an account failure.
                self.provider_for(epoch, |p| p.error = None);
                Ok(())
            }
            _ => {
                self.provider_for(epoch, |p| {
                    p.error = Some(
                        "Could not verify the Playit connection. Check your network and retry."
                            .into(),
                    )
                });
                anyhow::bail!("Could not verify Playit. Your last successful setup check is kept.")
            }
        }
    }
    pub fn start_provider(&self, port: u16) {
        let Some(secret) = self.secret.lock().unwrap().clone() else {
            return;
        };
        self.stop_provider();
        let epoch = self.next_provider_epoch();
        let token = CancellationToken::new();
        *self.provider_cancel.lock().unwrap() = Some(token.clone());
        let svc = self.clone();
        tokio::spawn(async move {
            let api = PlayitApi::create(API.into(), Some(secret.clone()));
            let lookup = Arc::new(OriginLookup::default());
            loop {
                if token.is_cancelled() {
                    break;
                }
                svc.provider_for(epoch, |p| p.state = "connecting".into());
                if let Err(e) = svc.refresh_origins(&api, &lookup, port, epoch).await {
                    svc.provider_for(epoch, |p| p.error = Some(e.to_string()));
                }
                let settings = PlayitAgentSettings {
                    api_url: API.into(),
                    secret_key: secret.clone(),
                    tcp_settings: TcpSettings::default(),
                    udp_settings: UdpSettings::default(),
                };
                let built = tokio::select! {_=token.cancelled()=>break,r=tokio::time::timeout(Duration::from_secs(45),PlayitAgent::new(settings,lookup.clone()))=>r};
                match built {
                    Ok(Ok(agent)) => {
                        let cancel = agent.cancellation_token();
                        svc.provider_for(epoch, |p| {
                            p.agent_registered = true;
                            p.state = "agentRunning".into();
                        });
                        let mut handle = tokio::spawn(agent.run());
                        loop {
                            tokio::select! {
                             _=token.cancelled()=>{cancel.cancel();let _=tokio::time::timeout(Duration::from_secs(8),&mut handle).await;handle.abort();break},
                             _=&mut handle=>{svc.provider_for(epoch,|p|p.error=Some("Playit connection ended; reconnecting.".into()));break},
                             _=tokio::time::sleep(Duration::from_secs(20))=>{if let Err(e)=svc.refresh_origins(&api,&lookup,port,epoch).await{svc.provider_for(epoch,|p|p.error=Some(e.to_string()));}}
                            }
                        }
                    }
                    _ => svc.provider_for(epoch, |p| {
                        p.state = "retrying".into();
                        p.error = Some(
                            "Could not establish the Playit connection. Retrying in 10 seconds."
                                .into(),
                        );
                    }),
                }
                tokio::select! {_=token.cancelled()=>break,_=tokio::time::sleep(Duration::from_secs(10))=>{}}
            }
            svc.provider_for(epoch, |p| {
                p.state = if p.linked { "standby" } else { "disconnected" }.into();
                p.endpoints.clear();
            });
        });
    }
    pub fn stop_provider(&self) {
        self.next_provider_epoch();
        if let Some(t) = self.provider_cancel.lock().unwrap().take() {
            t.cancel()
        }
        let mut p = self.provider.lock().unwrap();
        p.state = if p.linked { "standby" } else { "disconnected" }.into();
        p.endpoints.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn linked_device_registers_before_any_world_exists() {
        let t = tempfile::tempdir().unwrap();
        let s = Service::new(t.path().join("data")).unwrap();
        s.provider.lock().unwrap().linked = true;
        assert!(s.prepare_provider(0, async { Ok(()) }).await.unwrap());
        let snapshot = s.snapshot().unwrap();
        assert!(snapshot.provider.agent_registered);
        assert_eq!(snapshot.provider.state, "standby");
        assert!(snapshot.data.worlds.is_empty());
        assert!(snapshot.session.is_none());
        assert!(snapshot.provider.endpoints.is_empty());
        assert!(!snapshot.data.provider_setup.tunnel_configured);
        assert!(s.provider_cancel.lock().unwrap().is_none());
        assert!(s.provider_registration.lock().unwrap().is_none());
        assert!(
            s.prepare_provider(0, async { panic!("already registered") })
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn failed_registration_keeps_authorization_and_can_retry() {
        let t = tempfile::tempdir().unwrap();
        let s = Service::new(t.path().join("data")).unwrap();
        s.provider.lock().unwrap().linked = true;
        assert!(
            s.prepare_provider(0, async { anyhow::bail!(REGISTRATION_RETRY) })
                .await
                .is_err()
        );
        let p = s.provider.lock().unwrap().clone();
        assert!(p.linked);
        assert!(!p.agent_registered);
        assert_eq!(p.state, "registrationFailed");
        assert_eq!(p.error.as_deref(), Some(REGISTRATION_RETRY));
        assert!(s.provider_registration.lock().unwrap().is_none());
        assert!(s.prepare_provider(0, async { Ok(()) }).await.unwrap());
        let p = s.provider.lock().unwrap();
        assert!(p.agent_registered);
        assert!(p.error.is_none());
    }

    #[tokio::test]
    async fn disconnect_cancels_registration_and_ignores_its_result() {
        let t = tempfile::tempdir().unwrap();
        let s = Service::new(t.path().join("data")).unwrap();
        s.provider.lock().unwrap().linked = true;
        let (started, wait) = tokio::sync::oneshot::channel();
        let task = tokio::spawn({
            let s = s.clone();
            async move {
                s.prepare_provider(0, async move {
                    started.send(()).unwrap();
                    std::future::pending().await
                })
                .await
            }
        });
        wait.await.unwrap();
        assert_eq!(s.provider.lock().unwrap().state, "registering");
        s.disconnect_provider().unwrap();
        assert!(
            !tokio::time::timeout(Duration::from_secs(1), task)
                .await
                .unwrap()
                .unwrap()
                .unwrap()
        );
        let p = s.provider.lock().unwrap();
        assert!(!p.linked);
        assert!(!p.agent_registered);
        assert_eq!(p.state, "disconnected");
        assert!(p.error.is_none());
    }

    #[tokio::test]
    async fn setup_check_never_replaces_a_hosting_agent() {
        let t = tempfile::tempdir().unwrap();
        let s = Service::new(t.path().join("data")).unwrap();
        let hosting = CancellationToken::new();
        *s.provider_cancel.lock().unwrap() = Some(hosting.clone());
        s.provider.lock().unwrap().state = "connecting".into();
        assert!(
            s.prepare_provider(0, async { panic!("hosting handles registration") })
                .await
                .unwrap()
        );
        assert!(!hosting.is_cancelled());
        assert_eq!(s.provider.lock().unwrap().state, "connecting");
        assert!(s.provider_registration.lock().unwrap().is_none());
    }

    #[test]
    fn tunnel_setup_survives_stop_but_not_disconnect() {
        let t = tempfile::tempdir().unwrap();
        let s = Service::new(t.path().join("data")).unwrap();
        s.observe_tunnels(0, true).unwrap();
        s.stop_provider();
        assert!(s.data().unwrap().provider_setup.tunnel_configured);
        s.observe_tunnels(0, false).unwrap();
        assert!(
            s.data().unwrap().provider_setup.tunnel_configured,
            "old connection must not change a newer setup state"
        );
        s.disconnect_provider().unwrap();
        assert!(!s.data().unwrap().provider_setup.tunnel_configured);
    }
    #[test]
    fn delayed_credential_lookup_cannot_restore_authorization_after_disconnect() {
        let t = tempfile::tempdir().unwrap();
        let s = Service::new(t.path().join("data")).unwrap();
        s.disconnect_provider().unwrap();
        s.finish_loading_secret(0, Ok(Some("test-only-old-authorization".into())));
        assert!(s.secret.lock().unwrap().is_none());
        assert!(!s.provider.lock().unwrap().linked);
        assert_eq!(s.provider.lock().unwrap().state, "disconnected");
    }
}
