# Wazuh 5.0 Migration Checklist

Target: `wazuh/wazuh-manager:5.0.0`, `wazuh/wazuh-indexer:5.0.0`, `wazuh/wazuh-dashboard:5.0.0`  
Branch: `wazuh-5`  
Base: chart v2.5.5 / appVersion 4.14.10

Status legend: `[ ]` todo · `[x]` done · `[~]` stub only (needs GA image verification)

---

## Phase 1 — Remove Filebeat (5.0 ships no Filebeat sidecar)

- [x] **1.1** Delete `charts/wazuh/templates/certs/filebeat/certificate.yaml`
- [x] **1.2** Delete `charts/wazuh/templates/_filebeat_config.tpl`
- [x] **1.3** `manager/master/statefulset.yaml` — remove `filebeat-certs` volume
- [x] **1.4** `manager/master/statefulset.yaml` — remove all filebeat volumeMounts from wazuh-manager container
- [x] **1.5** `manager/master/statefulset.yaml` — remove filebeat env vars (`FILEBEAT_SSL_CERTIFICATE_AUTHORITIES`, `FILEBEAT_SSL_CERTIFICATE`, `FILEBEAT_SSL_KEY`)
- [x] **1.6** `manager/master/statefulset.yaml` — remove `checksum/filebeat-certificate` autoreload annotation
- [x] **1.7** `manager/worker/statefulset.yaml` — same removals as 1.3–1.6
- [x] **1.8** `manager/configmap.yaml` — remove filebeat.yml key from ConfigMap data
- [x] **1.9** `values.yaml` — remove `wazuh.filebeat` section entirely
- [x] **1.10** `values.schema.json` — remove filebeat property from schema

---

## Phase 2 — New TLS Certificates (remoted + authd)

- [ ] **2.1** Create `charts/wazuh/templates/certs/remoted/` directory and `certificate.yaml`  
  Issues `remoted-tls` Secret — used by port 1514 (agent syslog/event channel)
- [ ] **2.2** Create `charts/wazuh/templates/certs/authd/` directory and `certificate.yaml`  
  Issues `authd-tls` Secret — used by ports 1515 (authd) and 1517 (HTTPS enrollment)
- [ ] **2.3** `manager/master/statefulset.yaml` — add `remoted-certs` and `authd-certs` volumes
- [ ] **2.4** `manager/master/statefulset.yaml` — add remoted + authd volumeMounts under `/etc/wazuh-manager/ssl/`
- [ ] **2.5** `manager/worker/statefulset.yaml` — same volumes + mounts
- [ ] **2.6** `manager/master/statefulset.yaml` — add autoreload checksums for new cert secrets
- [ ] **2.7** `manager/worker/statefulset.yaml` — same autoreload checksums
- [ ] **2.8** `values.yaml` — add `wazuh.remoted.certificate` and `wazuh.authd.certificate` cert config blocks

---

## Phase 3 — Config Path Migration (/var/ossec → /etc/wazuh-manager)

- [ ] **3.1** `manager/master/statefulset.yaml` — update all volumeMount `mountPath` values:
  - `/var/ossec/data` → `/var/wazuh/data` (data dir unchanged in 5.0 — verify at GA)
  - `/var/ossec/logs` → `/var/wazuh/logs`
  - Init container output path: `/wazuh-config-mount/etc/` → `/wazuh-config-mount/etc/wazuh-manager/`
- [ ] **3.2** `manager/worker/statefulset.yaml` — same path updates
- [ ] **3.3** `manager/configmap.yaml` — update script.sh target path for init container
- [ ] **3.4** `_ossec_conf.tpl` — update any hardcoded `/var/ossec` paths in generated ossec.conf

---

## Phase 4 — New Agent Protocol (port 1517, HTTPS enrollment)

- [ ] **4.1** `manager/master/service.yaml` — add port 1517 (`remoted-https`) to the Service spec
- [ ] **4.2** `values.yaml` — add `wazuh.master.service.ports` entry for 1517
- [ ] **4.3** `_ossec_conf.tpl` — add `<remote>` block for HTTPS protocol on port 1517
- [~] **4.4** `manager/master/statefulset.yaml` — add enrollment token Secret volume + env var  
  *(stub — exact Secret key name needs 5.0 GA image verification)*
- [~] **4.5** `manager/master/statefulset.yaml` — add `WAZUH_ENROLLMENT_PORT=1517` env var  
  *(stub — verify env var name against 5.0 image)*
- [~] **4.6** `agent/daemonset.yaml` — update agent enrollment env vars to use HTTPS + port 1517  
  *(stub — verify agent image env var names)*

---

## Phase 5 — Cluster Always-On + ossec.conf Cleanup

- [ ] **5.1** `_ossec_conf.tpl` — remove `<disabled>yes</disabled>` from `<cluster>` block  
  (5.0 requires cluster mode always enabled; single-node "cluster" of 1 master is valid)
- [ ] **5.2** `_ossec_conf.tpl` — update `<cluster>` node_type to use `master`/`worker` literals
- [ ] **5.3** `_ossec_conf.tpl` — remove Filebeat `<logall_json>` block (no Filebeat consumer)

---

## Phase 6 — Indexer Credential User Rename (admin → wazuh-server)

- [ ] **6.1** `indexer/secret.yaml` — change default INDEXER_USERNAME from `admin` to `wazuh-server`
- [ ] **6.2** `manager/configmap.yaml` / `_ossec_conf.tpl` — update username used for indexer API calls
- [ ] **6.3** `indexer/securityconfig.yaml` or equivalent — update internal_users.yml template to use `wazuh-server` role
- [ ] **6.4** `values.yaml` — update default `indexer.cred` comment and example from `admin` to `wazuh-server`
- [ ] **6.5** `architecture/runbooks/credential-rotation.md` — update Rotate Indexer Credentials section

---

## Phase 7 — Chart Metadata + Image Tags

- [ ] **7.1** `Chart.yaml` — bump `appVersion` to `5.0.0`
- [ ] **7.2** `Chart.yaml` — bump chart `version` to `3.0.0` (major bump = breaking changes)
- [ ] **7.3** `Chart.yaml` — update `artifacthub.io/changes` block
- [ ] **7.4** `values.yaml` — update all `images.tag` defaults to `5.0.0`:
  - `indexer.images.tag`
  - `dashboard.images.tag`
  - `wazuh.images.tag`

---

## Phase 8 — values.yaml + Schema Cleanup

- [ ] **8.1** `values.yaml` — add new certificate config blocks (remoted, authd) with comments
- [ ] **8.2** `values.yaml` — remove filebeat section
- [ ] **8.3** `values.schema.json` — regenerate/update schema to match all value changes
- [ ] **8.4** Run `helm lint charts/wazuh` and fix any warnings

---

## Phase 9 — Documentation Updates

- [ ] **9.1** `architecture/overview.md` — update architecture overview section for 5.0 (no Filebeat, new ports, new TLS)
- [ ] **9.2** `architecture/architecture.md` — update ASCII diagrams (remove Filebeat from pods, add port 1517)
- [ ] **9.3** `architecture/values-guide.md` — remove filebeat section, add remoted/authd cert sections, update image tags
- [ ] **9.4** `architecture/runbooks/credential-rotation.md` — update `admin` → `wazuh-server` throughout
- [ ] **9.5** `architecture/graph.html` — update D3 diagram nodes: remove filebeat node, add remoted-tls/authd-tls cert nodes, add port 1517 edge
- [ ] **9.6** `architecture/index.html` — update version chips (chart 3.0.0, app 5.0.0)

---

## Phase 10 — Verification (GA image required)

- [~] **10.1** Boot manager image `wazuh/wazuh-manager:5.0.0` — verify config path is `/etc/wazuh-manager`
- [~] **10.2** Verify enrollment token Secret key name and mount point
- [~] **10.3** Verify agent HTTPS enrollment env var names
- [~] **10.4** Verify indexer username is `wazuh-server` in 5.0 security config
- [~] **10.5** Run `helm install` dry-run against a real cluster, check pod readiness
- [~] **10.6** Verify agent can enroll via port 1517 HTTPS

---

## Completion Order

Phases are designed to be done in order. Each phase is independent enough to commit separately.  
Phases 1–8 can be done without any 5.0 images.  
Phase 10 requires GA images and a real cluster.

**Current progress**: Phase 1 complete (commit `8b96367`). Next: Phase 2 — new TLS certs.
