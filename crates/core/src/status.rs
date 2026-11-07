use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    net::{IpAddr, Ipv6Addr},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub address: String,
    pub version: String,
    pub online: u64,
    pub maximum: u64,
    pub description: String,
    pub latency_ms: u64,
    pub observed_at: u64,
}
pub fn address(s: &str) -> Result<(String, u16, bool)> {
    let s = s.trim();
    ensure!(
        !s.is_empty()
            && s.len() <= 255
            && !s.chars().any(|c| c.is_control() || c.is_whitespace())
            && !s.contains(['/', '\\', '@', '?', '#']),
        "Enter a Minecraft hostname or IP, with an optional port."
    );
    if s.starts_with('[') {
        let end = s
            .find(']')
            .context("IPv6 address needs a closing bracket")?;
        let host = &s[1..end];
        host.parse::<Ipv6Addr>()?;
        let tail = &s[end + 1..];
        let port = if tail.is_empty() {
            25565
        } else {
            tail.strip_prefix(':')
                .context("Invalid IPv6 port")?
                .parse()?
        };
        ensure!(port > 0, "Port must be 1–65535");
        return Ok((host.into(), port, !tail.is_empty()));
    }
    let parts: Vec<_> = s.split(':').collect();
    ensure!(parts.len() <= 2, "Wrap IPv6 addresses in brackets.");
    let host = parts[0];
    ensure!(
        host.split('.').all(|p| !p.is_empty()
            && p.len() <= 63
            && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            && !p.starts_with('-')
            && !p.ends_with('-')),
        "Invalid hostname"
    );
    let port = if parts.len() == 2 {
        parts[1].parse()?
    } else {
        25565
    };
    ensure!(port > 0, "Port must be 1–65535");
    Ok((host.into(), port, parts.len() == 2))
}
fn varint(mut v: u32) -> Vec<u8> {
    let mut b = vec![];
    loop {
        let mut x = (v & 127) as u8;
        v >>= 7;
        if v != 0 {
            x |= 128
        }
        b.push(x);
        if v == 0 {
            break;
        }
    }
    b
}
async fn read_varint(s: &mut TcpStream) -> Result<u32> {
    let mut value = 0;
    for i in 0..5 {
        let b = s.read_u8().await?;
        if i == 4 {
            ensure!(b & 0xf0 == 0, "Invalid protocol length");
        }
        value |= ((b & 127) as u32) << (7 * i);
        if b & 128 == 0 {
            return Ok(value);
        }
    }
    anyhow::bail!("Invalid protocol length")
}
fn decode_varint(b: &[u8]) -> Result<(u32, usize)> {
    let mut n = 0;
    for (i, x) in b.iter().take(5).enumerate() {
        ensure!(i != 4 || x & 0xf0 == 0, "Invalid packet");
        n |= ((x & 127) as u32) << (i * 7);
        if x & 128 == 0 {
            return Ok((n, i + 1));
        }
    }
    anyhow::bail!("Truncated protocol length")
}
fn plain(v: &serde_json::Value) -> String {
    if let Some(s) = v.as_str() {
        return s.chars().filter(|c| !c.is_control()).take(500).collect();
    }
    let mut t = v["text"].as_str().unwrap_or("").to_owned();
    if let Some(a) = v["extra"].as_array() {
        for x in a.iter().take(40) {
            t.push_str(&plain(x));
        }
    }
    t.chars().filter(|c| !c.is_control()).take(500).collect()
}
pub async fn check(input: &str) -> Result<ServerStatus> {
    tokio::time::timeout(Duration::from_secs(8), query(input))
        .await
        .context("Server check timed out. Check the address and whether the host is running.")?
}
async fn query(input: &str) -> Result<ServerStatus> {
    let (host, port, explicit) = address(input)?;
    let mut target = (host.clone(), port);
    if !explicit
        && host.parse::<IpAddr>().is_err()
        && let Ok(resolver) = hickory_resolver::TokioAsyncResolver::tokio_from_system_conf()
        && let Ok(Ok(lookup)) = tokio::time::timeout(
            Duration::from_secs(2),
            resolver.srv_lookup(format!("_minecraft._tcp.{host}")),
        )
        .await
        && let Some(r) = lookup.iter().min_by_key(|r| r.priority())
    {
        target = (r.target().to_utf8().trim_end_matches('.').into(), r.port());
    }
    let t = Instant::now();
    let mut s = TcpStream::connect((target.0.as_str(), target.1))
        .await
        .context("Cannot reach this Minecraft server")?;
    let mut packet = vec![0];
    // Minecraft-aware relays can reject -1 as an invalid protocol version.
    // A real Java version works for status queries even when gameplay requires
    // a different version. 763 is Minecraft Java 1.20.1.
    packet.extend(varint(763));
    packet.extend(varint(host.len() as u32));
    packet.extend(host.as_bytes());
    packet.extend(port.to_be_bytes());
    packet.push(1);
    s.write_all(&varint(packet.len() as u32)).await?;
    s.write_all(&packet).await?;
    s.write_all(&[1, 0]).await?;
    let len = read_varint(&mut s).await?;
    ensure!(len <= 1_048_576, "Server response is too large");
    let mut buf = vec![0; len as usize];
    s.read_exact(&mut buf).await?;
    ensure!(buf.first() == Some(&0), "Unexpected Minecraft response");
    let (n, start) = decode_varint(&buf[1..])?;
    ensure!(
        n as usize + start + 1 == buf.len(),
        "Malformed server status"
    );
    let v: serde_json::Value = serde_json::from_slice(&buf[1 + start..])?;
    Ok(ServerStatus {
        address: input.trim().into(),
        version: v["version"]["name"]
            .as_str()
            .unwrap_or("Unknown")
            .chars()
            .take(100)
            .collect(),
        online: v["players"]["online"].as_u64().unwrap_or(0),
        maximum: v["players"]["max"].as_u64().unwrap_or(0),
        description: plain(&v["description"]),
        latency_ms: t.elapsed().as_millis() as u64,
        observed_at: crate::model::now(),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_addresses() {
        for v in ["example.net", "localhost:25565", "127.0.0.1", "[::1]:25566"] {
            assert!(address(v).is_ok(), "{v}");
        }
        for v in [
            "",
            "https://example.net",
            "localhost:0",
            "a:65536",
            "[:::]",
            "a..net",
            "a:1:2",
            "-host",
            "a:",
        ] {
            assert!(address(v).is_err(), "{v}");
        }
    }
    #[test]
    fn protocol_lengths() {
        for n in [0, 127, 128, 65535, u32::MAX] {
            assert_eq!(decode_varint(&varint(n)).unwrap().0, n);
        }
        assert!(decode_varint(&[255, 255, 255, 255, 255]).is_err());
    }
    #[tokio::test]
    async fn status_roundtrip_and_oversized_response() {
        for oversized in [false, true] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap().to_string();
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let len = read_varint(&mut stream).await.unwrap();
                let mut packet = vec![0; len as usize];
                stream.read_exact(&mut packet).await.unwrap();
                assert_eq!(packet[0], 0);
                assert_eq!(*packet.last().unwrap(), 1);
                let (protocol, _) = decode_varint(&packet[1..]).unwrap();
                // Model Playit's protocol validation: the old -1 probe must
                // not pass just because vanilla accepts it for a status check.
                if protocol > i32::MAX as u32 {
                    return;
                }
                let mut request = [0; 2];
                stream.read_exact(&mut request).await.unwrap();
                assert_eq!(request, [1, 0]);
                if oversized {
                    stream.write_all(&varint(2_000_000)).await.unwrap();
                    return;
                }
                let json=br#"{"version":{"name":"Fabric 1.21.1"},"players":{"online":2,"max":8},"description":{"text":"Hello ","extra":[{"text":"friends"}]}}"#;
                let mut response = vec![0];
                response.extend(varint(json.len() as u32));
                response.extend(json);
                stream
                    .write_all(&varint(response.len() as u32))
                    .await
                    .unwrap();
                stream.write_all(&response).await.unwrap();
            });
            let result = check(&address).await;
            server.await.unwrap();
            if oversized {
                assert!(result.unwrap_err().to_string().contains("too large"));
            } else {
                let s = result.unwrap();
                assert_eq!(s.online, 2);
                assert_eq!(s.maximum, 8);
                assert_eq!(s.description, "Hello friends");
            }
        }
    }
}
