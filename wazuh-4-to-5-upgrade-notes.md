# Wazuh 4 → 5 Upgrade Notes
Branch: `wazuh-5` | Chart: `2.5.5 → 3.0.0` | App: `4.14.10 → 5.0.0`

---

## What You Must Do Before Upgrading

### 1. Remove all `wazuh.filebeat.*` values from your overrides
Filebeat is gone. If any of your values files set `wazuh.filebeat.*`, remove them.
The `filebeat-tls` Secret is no longer created — delete it from your cluster if it exists.

**Commit:** `8b96367` — Phase 1: removed Filebeat sidecar, certs, env vars

### 2. Allow new TLS Secrets in cert-manager policies
Two new `Certificate` resources are created when `certificates.enabled: true`:
- `remoted-tls` — agent event channel (port 1514)
- `authd-tls` — agent enrollment (ports 1515 and 1517)

If you use `CertificateRequestPolicy`, the CN allowlist comment was updated.
Check your policy allows CNs: `admin, dashboard, node, remoted, authd`.

**Commit:** `7c22305` — Phase 2: remoted-tls and authd-tls Certificates added

### 3. Open port 1517 on your firewall / NetworkPolicy
Wazuh 5.0 agents enroll over HTTPS on port **1517**. This port is now added to the
master Service. Update any firewall rules or NetworkPolicy `extraIngresses` to allow it.

**Commit:** `56a15c1` — Phase 4: port 1517 added to master Service and ossec.conf

### 4. Update the indexer credential Secret
The indexer username changed from `admin` to `wazuh-server`.

- If you use `indexer.cred.existingSecret`: update the Secret's `username` field to
  `wazuh-server` **before** upgrading, then run the upgrade.
- If you let the chart manage it: nothing to do — the chart generates the new Secret.

The securityconfig bootstrap Job now creates the `wazuh-server` internal user automatically.

**Commit:** `56a15c1` — Phase 6: wazuh-server user, credential rename

### 5. Update all pinned image tags
If your values files pin image tags, update all three from `4.14.10` → `5.0.0`:

```yaml
indexer:
  images:
    tag: "5.0.0"
dashboard:
  images:
    tag: "5.0.0"
wazuh:
  images:
    tag: "5.0.0"
```

**Commit:** `56a15c1` — Phase 7: image tags updated

---

## Files Changed and Why

| File | Commit | What Changed |
|------|--------|--------------|
| `templates/manager/master/statefulset.yaml` | `8b96367` | Removed filebeat-certs volume, volumeMounts, env vars, checksum annotation. Added remoted-certs + authd-certs volumes and mounts (`7c22305`) |
| `templates/manager/worker/statefulset.yaml` | `8b96367` | Same as master |
| `templates/manager/configmap.yaml` | `8b96367` | Removed `filebeat.yml` key from ConfigMap data |
| `templates/certs/filebeat/` | `8b96367` | **Deleted** — no longer exists |
| `templates/_filebeat_config.tpl` | `8b96367` | **Deleted** — no longer exists |
| `templates/certs/remoted/certificate.yaml` | `7c22305` | **New** — issues `remoted-tls` Secret |
| `templates/certs/authd/certificate.yaml` | `7c22305` | **New** — issues `authd-tls` Secret |
| `templates/manager/master/service.yaml` | `56a15c1` | Port 1517 added (data-driven from values) |
| `templates/_ossec_conf.tpl` | `56a15c1` | Added `<remote>` block for port 1517; updated `ssl_manager_cert/key` to reference authd-tls mount path |
| `templates/indexer/secret.yaml` | `56a15c1` | INDEXER_USERNAME default: `admin` → `wazuh-server` |
| `templates/indexer/secret-securityconfig.yaml` | `56a15c1` | Added `wazuh-server` internal user entry with admin backend_role |
| `templates/certs/component.crp.yaml` | `ea8a4b4` | CN comment updated: `filebeat` → `remoted, authd` |
| `templates/certs/node.crp.yaml` | `ea8a4b4` | Same CN comment fix |
| `values.yaml` | `56a15c1`, `7cb981c` | Added `wazuh.remoted.certificate` + `wazuh.authdCert.certificate` blocks; removed `wazuh.filebeat` section; all image tags → `5.0.0` |
| `values.schema.json` | `7cb981c`, `069c230` | Schema updated for new cert blocks; root `additionalProperties` → `true` (allows platform-injected values like kubriX) |
| `Chart.yaml` | `56a15c1` | `appVersion: 5.0.0`, `version: 3.0.0` |

---

## Repo Structure Changes

| Commit | What Changed |
|--------|--------------|
| `bb67c74` | Flattened chart to repo root — `Chart.yaml`, `values.yaml`, `templates/`, `files/` are now at root. `charts/wazuh/` removed. |
| `bb67c74` | Misc files moved to `others/` — DOCS, LICENSE, example, tests, images, cr.yaml, local-kind-install.sh, etc. |
| `c4d6986` | `.gitignore` updated — `Chart.lock` and `charts/*.tgz` are no longer ignored (needed for ArgoCD vendoring) |
| `3f11886` | `values-staging.yaml` added at root for ArgoCD staging environment |

---

## ArgoCD / Deployment Notes

- ArgoCD `spec.source.path` must be `.` (repo root) — `Chart.yaml` is now at the root
- Run `helm dependency update .` locally and commit `Chart.lock` + `charts/cert-manager-1.19.3.tgz` before ArgoCD can resolve the cert-manager dependency
- The schema now allows `additionalProperties: true` at root — platform-injected values (e.g. `kubriXTeamName`) will not fail schema validation

---

## Still Pending (verify against GA image)

- **Config path**: The 5.0 image may use `/etc/wazuh-manager/` instead of `/var/ossec/`. Boot the image and check before going to production.
- **Enrollment token**: Secret key name and env var for port 1517 token-based enrollment needs GA image verification.
- **Agent env vars**: HTTPS enrollment env var names for the agent DaemonSet need verifying against the 5.0 agent image.
