# Wazuh Helm Chart — Architecture Overview

## 1. Repository Layout

```
wazuh-helm/
├── charts/wazuh/
│   ├── Chart.yaml              # Chart metadata, version, dependencies
│   ├── values.yaml             # Default configuration
│   ├── values.schema.json      # JSON schema validation
│   ├── templates/              # Kubernetes manifests (Helm templates)
│   │   ├── agent/
│   │   ├── certs/
│   │   ├── dashboard/
│   │   ├── indexer/
│   │   └── manager/
│   ├── files/                  # Static files (ossec configs, scripts)
│   └── example/                # Example override charts
├── architecture/               # This documentation folder
├── .github/workflows/          # CI/CD pipelines
└── cr.yaml                     # chart-releaser config
```

## 2. Chart Metadata

| Field | Value |
|---|---|
| Chart version | 2.5.5 |
| App version | 4.14.10 |
| API version | v2 |
| Type | application |
| cert-manager subchart | 1.19.3 |

## 3. Architecture Overview

Wazuh on Kubernetes consists of three core components running in the same namespace:

1. **Wazuh Indexer** — OpenSearch-based data store. Receives alerts from Manager via Filebeat.
2. **Wazuh Manager** — The SIEM engine. Master node manages agents; Worker nodes process events.
3. **Wazuh Dashboard** — OpenSearch Dashboards fork. Visualises alerts and agent inventory.
4. **Wazuh Agent** — DaemonSet deployed on every node. Ships host events to Manager.

All inter-component traffic is TLS-encrypted using certificates issued by an in-cluster CA (cert-manager).

## 4. Wazuh Indexer

- **Kind:** StatefulSet
- **Image:** `wazuh/wazuh-indexer:4.14.10`
- **Default replicas:** 3 (always use odd numbers for quorum)
- **Storage:** PVC per pod via `volumeClaimTemplates`, ReadWriteOnce
- **Ports:** 9200 (REST/HTTPS), 9300 (transport)
- **Services:** `<name>-indexer` (ClusterIP REST) + `<name>-indexer-nodes` (headless transport)
- **TLS:** node-tls Secret mounted at `/usr/share/wazuh-indexer/config/certs/`
- **Security bootstrap:** post-install Job runs `securityadmin.sh` to apply users/roles/mappings

### Post-install Job

The securityadmin Job (`<name>-indexer-securityadmin`) runs after every install/upgrade:

- Hook: `post-install,post-upgrade`
- Delete policy: `before-hook-creation,hook-succeeded`
- Runs `securityadmin.sh -cd /opensearch-security/ -cacert root-ca.pem -cert admin.pem -key admin-key.pem -p 9200`
- If the Indexer is not yet ready, the Job retries (backoffLimit: 6)

## 5. Wazuh Manager

The Manager runs as two separate StatefulSets sharing the same ConfigMap.

### 5.1 Master

- **Replicas:** always 1 (fixed)
- **Ports:** 1515 (agent enrollment/authd), 55000 (REST API), 1516 (cluster)
- **initContainer:** Alpine runs `script.sh` to merge ossec.conf from ConfigMap into emptyDir
- **Volumes:** manager-config (CM), filebeat-certs, api-certs (optional), wazuh-authd-pass, result-config (emptyDir)
- **Filebeat sidecar:** ships alerts to Indexer over TLS (filebeat-tls Secret)

### 5.2 Workers

- **Replicas:** configurable (default 2)
- **Cluster communication:** headless Service `<name>-manager-cluster` port 1516
- **Same ConfigMap** as master, different `node-type` label

### Ruleset Reload Job

A separate Job (`ruleset-reload`) applies updated rules/decoders to running Manager pods without a full restart. Triggered manually or via Helm upgrade.

## 6. Wazuh Dashboard

- **Kind:** Deployment
- **Image:** `wazuh/wazuh-dashboard:4.14.10`
- **Default replicas:** 1
- **Port:** 5601 (HTTPS)
- **Service:** ClusterIP by default; Ingress or Gateway API HTTPRoute optional
- **TLS:** dashboard-tls Secret
- **Credentials:** indexer-cred + dashboard-cred + api-cred via envFrom

## 7. Wazuh Agent

- **Kind:** DaemonSet (one pod per node)
- **Image:** from `agent.images` in values
- **Connects to:** Manager Worker Service for event shipping, Manager Master for enrollment
- **Host mounts:** `/var/log`, `/proc`, `/sys`, `/etc`, `/dev`, `/boot`, `/usr`, `/lib/modules`
- **Credentials:** api-cred Secret for registration

## 8. Certificate Management

All TLS certificates are managed by cert-manager (optional subchart, `cert-manager.enabled`).

### Certificate Chain

```
SelfSigned Issuer
    └── Root CA Certificate (90d, renewBefore 15d)
            └── CA Issuer
                    ├── node-tls       (Indexer nodes)
                    ├── admin-tls      (securityadmin Job)
                    ├── dashboard-tls  (Dashboard)
                    ├── filebeat-tls   (Manager → Indexer)
                    └── api-tls        (Manager API, optional)
```

If `certificates.issuer.name` is set, an external issuer is used instead of the built-in SelfSigned chain.

## 9. Secrets Reference

| Secret Name | Contents | Consumed By |
|---|---|---|
| `indexer-cred` | INDEXER_USERNAME, INDEXER_PASSWORD | Indexer, Manager, Dashboard |
| `dashboard-cred` | DASHBOARD_USERNAME, DASHBOARD_PASSWORD | Dashboard |
| `wazuh-api-cred` | WAZUH_API_USER, WAZUH_API_PASSWORD | Manager, Dashboard, Agent |
| `wazuh-authd-pass` | authd password | Manager Master, Agent |
| `wazuh-cluster-key` | WAZUH_CLUSTER_KEY | Manager Master + Workers |
| `node-tls` | tls.crt, tls.key, ca.crt | Indexer StatefulSet |
| `admin-tls` | tls.crt, tls.key | securityadmin Job |
| `dashboard-tls` | tls.crt, tls.key | Dashboard |
| `filebeat-tls` | tls.crt, tls.key, ca.crt | Manager (Filebeat) |
| `api-tls` | tls.crt, tls.key | Manager API (optional) |
| `<name>-securityconfig` | internal_users.yml, roles.yml, etc. | Indexer, securityadmin Job |

## 10. Networking & Services

| Service | Type | Port(s) | Consumers |
|---|---|---|---|
| `<name>-indexer` | ClusterIP | 9200 | Manager (Filebeat), Dashboard, securityadmin Job |
| `<name>-indexer-nodes` | Headless | 9300 | Indexer pods (transport) |
| `<name>-manager-master` | ClusterIP | 1515, 55000 | Agent (enrollment), Dashboard (API) |
| `<name>-manager-cluster` | Headless | 1516 | Manager Master ↔ Workers |
| `<name>-manager-worker` | ClusterIP | 1514 | Agents (event shipping) |
| `<name>-dashboard` | ClusterIP | 5601 | Ingress / users |
| `<name>-manager-lb` | LoadBalancer | 1514, 1515, 55000 | External agents (optional) |

## 11. Gateway API

Both Dashboard and Manager API support Gateway API exposure (alternative to Ingress):

- **HTTPRoute** — routes HTTP/HTTPS traffic
- **ListenerSet** — defines listeners on the Gateway
- **BackendTLSPolicy** — enforces TLS between Gateway and backend pod

Enabled via `dashboard.gateway.enabled` and `wazuh.api.gateway.enabled`.

## 12. NetworkPolicy

Each component has a default-deny NetworkPolicy allowing only required flows:

| Policy | Allows Ingress From | Allows Egress To |
|---|---|---|
| Indexer | Manager (Filebeat :9200), Dashboard (:9200), securityadmin Job, Indexer pods (:9300) | DNS |
| Manager Master | Agents (:1515, :1514), Workers (:1516), Dashboard (:55000) | Indexer (:9200), DNS |
| Manager Worker | Agents (:1514), Master (:1516) | Indexer (:9200), DNS |
| Dashboard | Ingress/Gateway | Indexer (:9200), Manager (:55000), DNS |

DNS egress targets are configurable via `global.networkPolicy.dns.to`.

## 13. PodDisruptionBudgets

| Component | minAvailable |
|---|---|
| Indexer | 2 (keep quorum) |
| Manager Worker | 1 |
| Dashboard | 1 |

## 14. Storage

| PVC Name Pattern | Size | Access Mode | Component |
|---|---|---|---|
| `wazuh-indexer-<name>-indexer-{N}` | `indexer.storageSize` | RWO | Indexer (per pod) |
| `wazuh-manager-master-<name>-manager-master-0` | `wazuh.master.storageSize` | RWO | Manager Master |
| `wazuh-manager-worker-<name>-manager-worker-{N}` | `wazuh.worker.storageSize` | RWO | Manager Workers |
| `<name>-indexer-snapshots` | `indexer.snapshot.fs.size` | RWX | Indexer snapshots (optional) |

## 15. CI/CD Pipeline

Trigger: push to `main` branch.

1. **chart-releaser-action** (`helm/chart-releaser-action@v1.7.0`):
   - `cr package` — packages the chart into a `.tgz`
   - `cr upload` — uploads the package to GitHub Releases
   - `cr index` — updates `index.yaml` on `gh-pages` branch
2. Chart is signed with GPG (key: `Wazuh Helm Release Bot`)
3. Artifact Hub picks up the updated `index.yaml` automatically

## 16. High Availability Considerations

- Indexer requires an odd replica count (3, 5, …) for OpenSearch quorum
- Manager Master is always a single node (Wazuh cluster has one master)
- Manager Workers can be scaled horizontally
- Dashboard is stateless and can run multiple replicas
- `autoreload.enabled: true` adds ConfigMap/Secret checksums to pod annotations, triggering rolling restarts on config changes

## 17. Deployment Checklist

- [ ] Replace all default secrets before deploying to production
- [ ] Set `cert-manager.enabled: true` or provide `certificates.issuer.name`
- [ ] Choose storage class via `indexer.storageClass`, `wazuh.master.storageClass`
- [ ] Set `indexer.replicas` to an odd number ≥ 3
- [ ] Configure `global.networkPolicy.dns.to` for your CNI
- [ ] Enable `dashboard.ingress` or `dashboard.gateway` for external access
- [ ] Review `agent.enabled` — disable if agents are managed separately
- [ ] Set resource requests/limits for all components
- [ ] Enable `autoreload.enabled: true` for config-driven rolling restarts
