# EAS Update code signing — runbook

**Security Layer 1, Block 4 · Mobile (SEC-23)** · 2026-09-04

## Why

An OTA channel pushes JavaScript to every guest phone **with no store review in
between**. Whoever can publish an update owns the app on every device that has
installed it. Before this, the only control was one Expo account password.

With code signing, `expo-updates` verifies each manifest's signature against a
certificate compiled into the binary and **rejects anything it cannot verify**.
An attacker who takes the Expo account still cannot publish: they would also need
a private key that was never on Expo's servers.

## What is already done

- Keypair generated (RSA 2048, 10-year certificate, CN `Touch Padel OTA Updates`).
- `apps/mobile/certs/certificate.pem` — the **public** half. Committed on purpose;
  `.gitignore` carries an explicit exception to its blanket `*.pem` rule.
- `app.config.ts` declares `codeSigningCertificate` and
  `codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' }`.

## What you must do — the private key is NOT in the repository

The private key was written to this session's scratchpad and **must be moved and
then destroyed there**:

```
<scratchpad>/eas-keys/private-key.pem
```

1. **Store it** in the team password manager as `Touch Padel — EAS Update signing key`.
2. **Add it to EAS** so publishes can use it:
   ```
   eas secret:create --scope project --name EXPO_UPDATE_PRIVATE_KEY \
     --type file --value <path>/private-key.pem
   ```
3. **Delete the scratchpad copy.**
4. **Publish with it:**
   ```
   eas update --branch production --private-key-path <path>/private-key.pem
   ```

## The part that is easy to get wrong

Signing protects a device only once that device runs a binary **containing the
certificate**. Installs already in the wild keep accepting unsigned manifests, so
this must ship in a **store release** before it protects anyone. Until that release
is live, treat the Expo account password as still load-bearing.

## Rotation

The certificate is valid to **2036-09-04**. Rotating means shipping a new binary
with the new certificate; old installs continue to verify against the old one. Do
not delete the old key until store telemetry shows the old build is gone.
