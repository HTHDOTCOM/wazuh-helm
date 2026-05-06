# Wazuh Helm Chart — Blueprint

This blueprint documents how every component of this Helm chart works, how they connect, and what you must know before deploying. It is **read-only documentation** and has no effect on chart templates or rendered Kubernetes manifests.

---

## Table of Contents

1. [Repository Layout](#1-repository-layout)
2. [Chart Metadata](#2-chart-metadata)
3. [Architecture Overview](#3-architecture-overview)
4. [Component Deep-Dives](#4-component-deep-dives)
   - 4.1 [Wazuh Indexer (OpenSearch)](#41-wazuh-indexer-opensearch)
   - 4.2 [Wazuh Dashboard](#42-wazuh-dashboard)
   - 4.3 [Wazuh Manager — Master](#43-wazuh-manager--master)
   - 4.4 [Wazuh Manager — Workers](#44-wazuh-manager--workers)
   - 4.5 [Wazuh Agent (DaemonSet)](#45-wazuh-agent-daemonset)
5. [Certificate Management](#5-certificate-management)
6. [Secrets & Credentials](#6-secrets--credentials)
7. [Networking & Services](#7-networking--services)
8. [Security Controls](#8-security-controls)
9. [Storage (Persistent Volumes)](#9-storage-persistent-volumes)
10. [High Availability & Disruption Budgets](#10-high-availability--disruption-budgets)
11. [Ingress](#11-ingress)
12. [SSO / Authentication](#12-sso--authentication)
13. [Helm Template Helpers](#13-helm-template-helpers)
14. [Release & CI/CD Pipeline](#14-release--cicd-pipeline)
15. [Configuration Reference Map](#15-configuration-reference-map)
16. [Deployment Checklist](#16-deployment-checklist)

---

## 1. Repository Layout

```
wazuh-helm/
├── blueprint/                  ← This folder (docs only, no K8s impact)
│   ├── README.md               ← Master blueprint (this file)
│   ├── architecture.md         ← Component interaction diagrams
│   ├── values-guide.md         ← Every values.yaml key explained
│   └── runbooks/
│       ├── cert-rotation.md    ← How to rotate TLS certificates
│       ├── scaling.md          ← Scaling indexer/manager workers
│       └── credential-rotation.md
├── charts/
│   └── wazuh/
│       ├── Chart.yaml          ← Helm chart descriptor
│       ├── values.yaml         ← Default configuration (source of truth)
│       ├── templates/          ← Kubernetes manifest templates
│       │   ├── _helpers.tpl    ← Shared template functions
│       │   ├── agent/
│       │   ├── certs/
│       │   ├── dashboard/
│       │   ├── indexer/
│       │   └── manager/
│       └── example/            ← Reference values for common scenarios
├── DOCS/
│   └── 1_SSO_WITH_DEX_SERVER.md
├── .github/workflows/
│   └── release.yaml            ← Chart Releaser + GPG signing
├── .pre-commit-config.yaml     ← Auto-generates README from values annotations
├── cr.yaml                     ← Chart Releaser config
└── artifacthub-repo.yml        ← Artifact Hub listing metadata
```

> **Rule:** Nothing inside `blueprint/` is referenced by any template. Adding or removing files here has zero effect on `helm template` or `helm install` output.

---

## 2. Chart Metadata

| Field | Value |
|---|---|
| Chart API Version | `v2` (Helm 3 only) |
| Chart Name | `wazuh` |
| Chart Version | `1.0.22` |
| App Version | `4.14.1` |
| License | Apache 2.0 |
| Dependency | `cert-manager 1.18.1` (conditional on `cert-manager.enabled`) |

The chart follows [SemVer 2](https://semver.org/): `MAJOR.MINOR.PATCH`.  
`appVersion` tracks the upstream Wazuh release; `version` tracks the chart itself.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Kubernetes Cluster                           │
│                                                                     │
│  ┌──────────────┐     REST/9200      ┌─────────────────────────┐   │
│  │   Wazuh      │ ◄────────────────► │   Wazuh Indexer         │   │
│  │   Dashboard  │                    │   (OpenSearch)           │   │
│  │  (Deployment)│                    │   StatefulSet x3         │   │
│  └──────┬───────┘                    └─────────────────────────┘   │
│         │ HTTPS/443 (Ingress)                  ▲                    │
│         ▼                                      │ 9200               │
│  ┌──────────────┐                    ┌─────────┴───────────────┐   │
│  │   End User   │                    │   Wazuh Manager         │   │
│  └──────────────┘                    │   Master (StatefulSet x1)│   │
│                                      │   Workers (StatefulSet   │   │
│                                      │            x2)           │   │
│                                      └─────────────────────────┘   │
│                                                ▲                    │
│                                     1514/1515  │                    │
│  ┌──────────────────────────────────────────┐  │                    │
│  │   Wazuh Agent  (DaemonSet — every node)  │──┘                   │
│  └──────────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Data flow (left to right):**

1. Agents on each node collect OS/app logs and forward them to the Manager (TCP 1514 for events, TCP 1515 for enrollment).
2. The Manager processes, correlates, and enriches alerts, then ships them to the Indexer via Filebeat (port 9200).
3. The Dashboard reads from the Indexer (port 9200) and serves the web UI over HTTPS (port 5601 internally, 443 via Ingress).

---

## 4. Component Deep-Dives

### 4.1 Wazuh Indexer (OpenSearch)

| Attribute | Default |
|---|---|
| Workload type | `StatefulSet` |
| Default replicas | `3` |
| Image | `wazuh/wazuh-indexer:4.14.1` |
| CPU request/limit | `500m` / `1000m` |
| Memory request/limit | `1Gi` / `2Gi` |
| Storage per pod | `50Gi` |
| REST port | `9200` |
| Node-to-node port | `9300` |
| Metrics port | `9600` |

**How it works:**

- Runs as a 3-node OpenSearch cluster providing high-availability indexing and search.
- Each pod gets its own PVC (`data-wazuh-indexer-N`) provisioned by the cluster's default StorageClass.
- A headless Service (`wazuh-indexer-nodes`) enables peer discovery via DNS (`wazuh-indexer-0.wazuh-indexer-nodes`, etc.).
- A ClusterIP Service (`wazuh-indexer`) exposes the REST API internally.
- An optional snapshot PVC (`wazuh-indexer-snapshot`) can be used for index snapshots/backups.
- An init Job (`wazuh-indexer-init`) runs after deployment to bootstrap OpenSearch security (creates internal users, applies roles).

**Key values path:** `indexer.*`

---

### 4.2 Wazuh Dashboard

| Attribute | Default |
|---|---|
| Workload type | `Deployment` |
| Default replicas | `1` |
| Image | `wazuh/wazuh-dashboard:4.14.1` |
| CPU request/limit | `500m` / `1000m` |
| Memory request/limit | `512Mi` / `1Gi` |
| Service port | `5601` |

**How it works:**

- Serves the Wazuh web interface (a customised OpenSearch Dashboards build).
- Connects to the Indexer on port 9200 using TLS client certificates.
- Default admin user: `kibanaserver` / `kibanaserver` — **must be changed in production**.
- Supports OIDC, SAML, and basic authentication (see [Section 12](#12-sso--authentication)).
- Optionally exposed via Kubernetes Ingress (see [Section 11](#11-ingress)).

**Key values path:** `dashboard.*`

---

### 4.3 Wazuh Manager — Master

| Attribute | Default |
|---|---|
| Workload type | `StatefulSet` |
| Replicas | `1` (always) |
| Image | `wazuh/wazuh-manager:4.14.1` |
| Storage | `50Gi` |
| API port | `55000` |
| Agent enrollment port | `1515` |
| Agent events port | `1514` |
| Syslog port | `514` |

**How it works:**

- The master is the single coordination node for the Wazuh manager cluster.
- It holds the cluster key used to authenticate workers (`manager.clusterKey`).
- Handles the Wazuh REST API (`/api`), which the Dashboard uses to display alerts and configuration.
- A dedicated Service (`wazuh-manager-master`) exposes API and enrollment ports to other pods.

**Key values path:** `manager.master.*`

---

### 4.4 Wazuh Manager — Workers

| Attribute | Default |
|---|---|
| Workload type | `StatefulSet` |
| Default replicas | `2` |
| Image | `wazuh/wazuh-manager:4.14.1` |
| Storage | `50Gi` per worker |

**How it works:**

- Workers receive agent events (port 1514) and forward processed data to the Indexer via Filebeat.
- Worker pods join the manager cluster using the shared `clusterKey`.
- A LoadBalancer Service (or NLB) can optionally be provisioned to expose port 1514/1515 externally (`manager.worker.loadBalancer.enabled`).
- Pod anti-affinity rules spread workers across nodes for fault tolerance.

**Key values path:** `manager.worker.*`

---

### 4.5 Wazuh Agent (DaemonSet)

| Attribute | Default |
|---|---|
| Workload type | `DaemonSet` |
| Image | `kinseii/wazuh-agent:4.14.1` |
| CPU request/limit | `50m` / `100m` |
| Memory request/limit | `64Mi` / `128Mi` |

**How it works:**

- Runs one agent pod on **every** Kubernetes node to monitor node-level activity.
- Mounts host paths (`/var/log`, `/etc`, `/proc`, `/sys`, `/dev`, `/boot`, `/usr`, `/lib/modules`) read-only for log collection.
- Registers with the Manager via the enrollment service (port 1515) using API credentials stored in a Secret.
- Can be disabled entirely via `agent.enabled: false` if you manage agents outside Kubernetes.

**Key values path:** `agent.*`

---

## 5. Certificate Management

All internal TLS uses the `cert-manager` integration (disabled by default; enable via `cert-manager.enabled: true`).

### Certificate chain

```
Self-Signed ClusterIssuer
        │
        ▼
  Root CA Certificate  (rootca.yaml)
        │
        ├──► CA Issuer  (ca-issuer.yaml)
        │         │
        │         ├──► Indexer node certificates  (node/certificate.yaml)
        │         ├──► Admin certificate           (admin/certificate.yaml)
        │         ├──► Dashboard certificate       (dashboard/certificate.yaml)
        │         └──► Filebeat certificate        (filebeat/certificate.yaml)
        │
        └──► (ClusterResourcePolicies for cross-namespace cert replication)
```

| Resource | Purpose |
|---|---|
| `selfsigned-issuer.yaml` | Bootstrap issuer to sign the root CA |
| `rootca.yaml` | Root CA Certificate object |
| `ca-issuer.yaml` | Issuer that uses the Root CA for all leaf certs |
| `node/certificate.yaml` | TLS for Indexer inter-node + REST |
| `admin/certificate.yaml` | Admin client cert for Indexer security bootstrap |
| `dashboard/certificate.yaml` | TLS for Dashboard → Indexer connection |
| `filebeat/certificate.yaml` | TLS for Filebeat (inside Manager) → Indexer |
| `*.crp.yaml` | ClusterResourcePolicies to replicate secrets across namespaces |

**Certificate defaults:**

| Setting | Value |
|---|---|
| Duration | `2160h` (90 days) |
| Renew before | `360h` (15 days before expiry) |
| Key algorithm | RSA |

**Key values path:** `certificates.*`, `cert-manager.*`

---

## 6. Secrets & Credentials

| Secret | Values key | Default value | Change required? |
|---|---|---|---|
| Indexer admin password | `indexer.secret.password` | `WazuhSecretPassword` | **Yes** |
| Dashboard kibanaserver password | `dashboard.secret.password` | `kibanaserver` | **Yes** |
| Manager API user/password | `manager.api.credentials.*` | `wazuh-wui / MyS3cr37P450r.*-` | **Yes** |
| Manager authd password | `manager.authd.pass` | `password` | **Yes** |
| Manager cluster key | `manager.clusterKey` | `c98b62a9b6169ac5f67dae55ae4a9088` | **Yes** |
| Agent API credentials | `agent.apiCredentials.*` | (same as manager API) | **Yes** |

All secrets are rendered into Kubernetes `Secret` objects under `templates/*/secret*.yaml`. They are base64-encoded at render time by Helm.

> **Security note:** Never commit real credentials to source control. Use `--set` flags, sealed secrets, or an external secrets manager (e.g., AWS Secrets Manager, Vault).

---

## 7. Networking & Services

### Service inventory

| Component | Service name | Type | Ports |
|---|---|---|---|
| Indexer REST | `wazuh-indexer` | ClusterIP | 9200 |
| Indexer nodes (headless) | `wazuh-indexer-nodes` | ClusterIP (headless) | 9300, 9600 |
| Dashboard | `wazuh-dashboard` | ClusterIP | 5601 |
| Manager master | `wazuh-manager-master` | ClusterIP | 1515, 55000 |
| Manager workers | `wazuh-manager-workers` | ClusterIP | 1514, 1515, 514 |
| Manager LB (optional) | `wazuh-manager-lb` | LoadBalancer | 1514, 1515 |
| Agent | `wazuh-agent` | ClusterIP | (internal) |

### Network Policies

NetworkPolicies are enabled by default (`networkPolicy.enabled: true`) for the Indexer, Dashboard, and Manager components. They follow a **default-deny-all + explicit-allow** model:

- Indexer allows ingress only from Dashboard and Manager pods.
- Dashboard allows ingress from Ingress controllers and the Indexer.
- Manager workers allow ingress from agents on port 1514/1515.

**Key values path:** `networkPolicy.*` per component.

### Dual-stack

IPv4/IPv6 dual-stack can be enabled globally:

```yaml
global:
  ipFamilies:
    - IPv4
    - IPv6
  ipFamilyPolicy: PreferDualStack
```

---

## 8. Security Controls

| Control | Default | Values key |
|---|---|---|
| Pod security context (runAsNonRoot) | Enabled | `*.securityContext.*` |
| Container security context | Enabled | `*.containerSecurityContext.*` |
| NetworkPolicy | Enabled | `*.networkPolicy.enabled` |
| Read-only root filesystem | Configurable per component | `*.containerSecurityContext.readOnlyRootFilesystem` |
| Image pull policy | `IfNotPresent` | `*.image.pullPolicy` |
| Private registry support | Via `imagePullSecrets` | `global.imagePullSecrets` |
| ServiceAccounts | Dedicated SA per component | `*.serviceAccount.*` |
| RBAC | Minimal — no cluster-admin | SA + Role per component |

---

## 9. Storage (Persistent Volumes)

| Component | PVC name pattern | Default size | Access mode |
|---|---|---|---|
| Indexer data | `data-wazuh-indexer-N` | `50Gi` | `ReadWriteOnce` |
| Indexer snapshot | `wazuh-indexer-snapshot` | configurable | `ReadWriteMany` (optional) |
| Manager master | `data-wazuh-manager-master-0` | `50Gi` | `ReadWriteOnce` |
| Manager workers | `data-wazuh-manager-worker-N` | `50Gi` | `ReadWriteOnce` |

All PVCs use `volumeClaimTemplates` inside StatefulSets so each pod has its own isolated volume. The StorageClass defaults to the cluster's default unless overridden via `*.storage.storageClass`.

---

## 10. High Availability & Disruption Budgets

| Component | Strategy | PodDisruptionBudget | Anti-affinity |
|---|---|---|---|
| Indexer | StatefulSet rolling update | `minAvailable: 2` | Preferred — spread across nodes |
| Dashboard | Deployment rolling update | `minAvailable: 1` | None (single replica default) |
| Manager Master | StatefulSet | None | N/A (single pod) |
| Manager Workers | StatefulSet rolling update | `minAvailable: 1` | Required — no two workers on same node |
| Agent | DaemonSet rolling update | None | N/A (one per node by design) |

PodDisruptionBudgets prevent Kubernetes from evicting too many pods during node maintenance. They are enabled via `*.podDisruptionBudget.enabled: true`.

---

## 11. Ingress

The Dashboard can be exposed externally via a Kubernetes Ingress resource.

```yaml
dashboard:
  ingress:
    enabled: true
    ingressClassName: nginx
    hostname: wazuh.example.com
    tls: true
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
```

**Key values path:** `dashboard.ingress.*`

The Ingress template is at `templates/dashboard/ingress.yaml`. It is only rendered when `dashboard.ingress.enabled: true`.

---

## 12. SSO / Authentication

Three authentication modes are supported for the Dashboard:

### 12.1 Basic Authentication (default)

Username/password stored in Indexer internal users. No extra config needed.

### 12.2 OpenID Connect (OIDC)

```yaml
dashboard:
  config:
    opensearch_security:
      auth:
        type: openid
      openid:
        connect_url: https://dex.example.com/.well-known/openid-configuration
        client_id: wazuh
        client_secret: <secret>
```

See `DOCS/1_SSO_WITH_DEX_SERVER.md` for a complete Dex-based example.

### 12.3 SAML

```yaml
dashboard:
  config:
    opensearch_security:
      auth:
        type: saml
```

Full SAML IdP configuration goes in the Dashboard ConfigMap under `opensearch_dashboards.yml`.

---

## 13. Helm Template Helpers

All shared template logic lives in `templates/_helpers.tpl`. Key named templates:

| Template name | Purpose |
|---|---|
| `wazuh.name` | Chart name (respects `nameOverride`) |
| `wazuh.fullname` | Full release name (respects `fullnameOverride`, max 63 chars) |
| `wazuh.chart` | `chart-version` label value |
| `wazuh.labels` | Standard Helm recommended labels |
| `wazuh.selectorLabels` | Selector labels (stable, used in Service selectors) |
| `wazuh.serviceAccountName` | Resolves SA name or falls back to `default` |

These helpers ensure consistent labelling across all resources and comply with the [Helm chart best practices](https://helm.sh/docs/chart_best_practices/).

---

## 14. Release & CI/CD Pipeline

### Workflow: `.github/workflows/release.yaml`

Triggered on push to `main` when `charts/wazuh/Chart.yaml` changes.

**Steps:**

1. Checkout repository with full history.
2. Configure Chart Releaser (`cr.yaml`) with GPG signing key from repository secrets.
3. `cr package` — packages the chart into a `.tgz`.
4. `cr upload` — uploads the `.tgz` to GitHub Releases.
5. `cr index` — updates the `gh-pages` branch `index.yaml` (Helm repo index).
6. Artifact Hub auto-discovers the new release via `artifacthub-repo.yml`.

### Pre-commit hooks: `.pre-commit-config.yaml`

Runs `bitnami/readme-generator-for-helm` to auto-regenerate `charts/wazuh/README.md` from `values.yaml` annotations (`## @param`) before each commit.

### cr.yaml

```yaml
sign: true
key: Wazuh Helm Chart
```

GPG key name must match the key imported in the GitHub Actions environment.

---

## 15. Configuration Reference Map

Quick lookup: where in `values.yaml` to find each concern.

| Concern | Top-level key |
|---|---|
| Indexer cluster size, resources, storage | `indexer` |
| Dashboard replicas, SSO, ingress | `dashboard` |
| Manager master config, API credentials | `manager.master` / `manager.api` |
| Manager worker count, LB | `manager.worker` |
| Agent enable/disable, host mounts | `agent` |
| TLS certificates | `certificates` |
| cert-manager installation | `cert-manager` |
| Global image pull secrets, IP family | `global` |
| Network policies (per component) | `<component>.networkPolicy` |
| Pod disruption budgets | `<component>.podDisruptionBudget` |
| Node selectors / tolerations | `<component>.nodeSelector` / `<component>.tolerations` |
| Extra environment variables | `<component>.extraEnv` |
| Extra Kubernetes spec overlays | `<component>.extraSpec` |

---

## 16. Deployment Checklist

Before running `helm install`:

- [ ] **Rotate all default credentials** (indexer, dashboard, manager API, authd, cluster key).
- [ ] **Set a StorageClass** that supports `ReadWriteOnce` (or `ReadWriteMany` for snapshots).
- [ ] **Verify cert-manager** is installed if `cert-manager.enabled: true`, or supply pre-existing TLS secrets.
- [ ] **Size resources** for production: at minimum 3 indexer nodes with 8Gi RAM each.
- [ ] **Set indexer JVM heap** to half the container memory limit (`indexer.env.OPENSEARCH_JAVA_OPTS`).
- [ ] **Configure Ingress** hostname and TLS for Dashboard external access.
- [ ] **Review NetworkPolicies** — ensure your CNI plugin supports them (Calico, Cilium, etc.).
- [ ] **Pin image tags** — avoid `latest`; always use a specific version tag.
- [ ] **Back up PVCs** before upgrades.
- [ ] **Test agent enrollment** after deployment with `agent.enabled: true`.
