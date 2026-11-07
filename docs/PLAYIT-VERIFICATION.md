# Playit setup verification — Enderlink 0.2.4

Recorded 2026-11-06 on macOS arm64. This change fixes the reported “tunnel type not supported” rejection when assigning a newly claimed Enderlink agent to a Minecraft Java tunnel.

## Cause and fix

Claim/exchange creates authorization but does not advertise the embedded agent's version/platform. Enderlink previously waited until a world started before performing this handshake, while its setup guide asked users to create the tunnel first. Playit's current dashboard requires `agent_version.schema_id` before it enables an agent in the tunnel picker. Missing version/schema information produces the reported error.

Enderlink now performs the upstream control handshake immediately after claim completion. Opening Settings or pressing **Check connection** also prepares previously linked devices. The temporary control socket is dropped after registration; no Minecraft process or traffic forwarder starts. An active hosting agent handles its own registration, and checks do not replace it. Concurrent setup checks serialize; disconnect and hosting transitions cancel obsolete checks. Network failures preserve the existing authorization for retry.

The UI distinguishes account linking, device registration, and tunnel configuration, and names the free endpoint explicitly. Missing tunnels are shown as the next setup step rather than an account failure. The Playit dependency remains pinned to the official `v1.2.0` release.

Primary sources checked:

- [Playit's control registration implementation](https://github.com/playit-cloud/playit-agent/blob/v1.2.0/packages/agent_core/src/agent_control/mod.rs): submits the real bundled agent version, platform, and protocol version to `/proto/register`.
- [Playit's current tunnel setup interface](https://playit.gg/account/setup/new-tunnel): its public application bundle requires a version schema before enabling an agent; Minecraft Java is offered without Premium.
- [Playit Premium documentation](https://playit.gg/support/playit-premium/): free tunnels use Global Anycast; regional tunnels are a Premium option.

## Reproduce the live setup check

Close Enderlink after stopping any world. Use an existing account previously saved through the app, and pass the existing app-data directory:

```sh
cargo run -p enderlink-core --example verify_playit_setup --locked -- "/path/to/Enderlink/app-data"
```

The command uses the normal exclusive app-data lock and system credential store. It registers that existing agent and reads tunnel configuration, updates the normal setup observation, and prints only success/configuration flags. It does not create another account/agent, provision a tunnel, print a key, start Minecraft, or forward traffic.

## Verification

- 30 Rust tests pass, including new coverage for registration before world creation, failure/retry without losing linking, cancellation on disconnect, and avoiding a second handshake while hosting.
- 10 React workflow tests pass, including preparation of an older saved link with no world and separate pending-registration feedback.
- Rust Clippy with warnings denied, TypeScript, and the production frontend build pass.
- Production UI regression checks pass in Chromium with test-only IPC fixtures.

- Live check against the already saved Playit authorization passed: the upstream API/control handshake accepted the device, and the tunnel list reported no Minecraft Java tunnel yet. No new account/agent was created, no secret was printed, and no Minecraft process or forwarder started.

- The native macOS arm64 release build passes and produces Enderlink 0.2.4.
- The rebuilt app reopened successfully. The existing installed component and saved setup were preserved; no world or active server was created by verification. `scripts/package-macos.sh` produced `target/release/bundle/dmg/Enderlink_0.2.4_arm64.dmg`, and `hdiutil verify` passed.

Remote Minecraft joining and Windows/Linux execution remain separate acceptance checks.
