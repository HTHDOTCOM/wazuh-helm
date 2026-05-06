# Values Guide — Every Key Explained

This file explains every top-level section in `charts/wazuh/values.yaml` and what each key controls.  
It mirrors the structure of the file so you can read them side-by-side.

---

## global

Controls cluster-wide settings applied to all components.

| Key | Type | Default | Description |
|---|---|---|---|
| `global.imagePullSecrets` | list | `[]` | Secrets for pulling images from private registries. Each entry is `{ name: "<secret-name>" }`. |
| `global.ipFamilies` | list | `["IPv4"]` | IP families for all Services. Set to `["IPv4", "IPv6"]` for dual-stack. |
| `global.ipFamilyPolicy` | string | `SingleStack` | Kubernetes Service IP family policy. Options: `SingleStack`, `PreferDualStack`, `RequireDualStack`. |

---

## cert-manager

Controls whether the bundled cert-manager dependency is installed.

| Key | Type | Default | Description |
|---|---|---|---|
| `cert-manager.enabled` | bool | `false` | Set to `true` to install cert-manager as a subchart. If cert-manager is already installed in your cluster, leave this `false` and set `certificates.enabled: true`. |
| `cert-manager.installCRDs` | bool | `true` | Installs cert-manager CRDs when `cert-manager.enabled` is `true`. |

---

## certificates

Controls TLS certificate issuance for all Wazuh components.

| Key | Type | Default | Description |
|---|---|---|---|
| `certificates.enabled` | bool | `false` | Enable cert-manager Certificate objects for all components. |
| `certificates.duration` | string | `2160h` | Certificate validity period (90 days). |
| `certificates.renewBefore` | string | `360h` | How early to renew before expiry (15 days). |
| `certificates.issuerName` | string | `wazuh-ca-issuer` | Name of the cert-manager Issuer/ClusterIssuer to use. |
| `certificates.issuerKind` | string | `Issuer` | `Issuer` (namespace-scoped) or `ClusterIssuer` (cluster-scoped). |

---

## indexer

Controls the Wazuh Indexer (OpenSearch) StatefulSet.

### indexer.image

| Key | Default | Description |
|---|---|---|
| `indexer.image.repository` | `wazuh/wazuh-indexer` | Container image repository. |
| `indexer.image.tag` | `4.14.1` | Image tag. Pin to a specific version in production. |
| `indexer.image.pullPolicy` | `IfNotPresent` | Pull policy. Use `Always` only during active development. |

### indexer.replicas

| Key | Default | Description |
|---|---|---|
| `indexer.replicas` | `3` | Number of OpenSearch data nodes. Minimum 3 for a production quorum. |

### indexer.resources

| Key | Default | Description |
|---|---|---|
| `indexer.resources.requests.cpu` | `500m` | CPU request per pod. |
| `indexer.resources.requests.memory` | `1Gi` | Memory request per pod. |
| `indexer.resources.limits.cpu` | `1000m` | CPU limit per pod. |
| `indexer.resources.limits.memory` | `2Gi` | Memory limit. Set JVM heap to half this value. |

### indexer.storage

| Key | Default | Description |
|---|---|---|
| `indexer.storage.size` | `50Gi` | PVC size per indexer pod. |
| `indexer.storage.storageClass` | `""` | StorageClass name. Empty = cluster default. |

### indexer.secret

| Key | Default | Description |
|---|---|---|
| `indexer.secret.password` | `WazuhSecretPassword` | OpenSearch admin password. **Change before deploying.** |

### indexer.snapshot

| Key | Default | Description |
|---|---|---|
| `indexer.snapshot.enabled` | `false` | Mount a shared PVC for index snapshots. |
| `indexer.snapshot.size` | `50Gi` | Size of the snapshot PVC. |

### indexer.networkPolicy

| Key | Default | Description |
|---|---|---|
| `indexer.networkPolicy.enabled` | `true` | Enable NetworkPolicy restricting indexer ingress. |

### indexer.podDisruptionBudget

| Key | Default | Description |
|---|---|---|
| `indexer.podDisruptionBudget.enabled` | `true` | Prevent eviction of more than 1 indexer pod at a time. |
| `indexer.podDisruptionBudget.minAvailable` | `2` | Minimum pods that must remain available. |

---

## dashboard

Controls the Wazuh Dashboard Deployment.

### dashboard.image

Same structure as `indexer.image`. Repository: `wazuh/wazuh-dashboard`.

### dashboard.replicas

| Key | Default | Description |
|---|---|---|
| `dashboard.replicas` | `1` | Number of dashboard pods. |

### dashboard.resources

| Key | Default | Description |
|---|---|---|
| `dashboard.resources.requests.memory` | `512Mi` | Memory request. |
| `dashboard.resources.limits.memory` | `1Gi` | Memory limit. |

### dashboard.secret

| Key | Default | Description |
|---|---|---|
| `dashboard.secret.password` | `kibanaserver` | Password for the `kibanaserver` user. **Change before deploying.** |

### dashboard.ingress

| Key | Default | Description |
|---|---|---|
| `dashboard.ingress.enabled` | `false` | Render an Ingress resource. |
| `dashboard.ingress.ingressClassName` | `""` | Ingress class (e.g. `nginx`, `traefik`). |
| `dashboard.ingress.hostname` | `""` | Fully qualified domain name for the dashboard. |
| `dashboard.ingress.tls` | `false` | Enable TLS on the Ingress. |
| `dashboard.ingress.annotations` | `{}` | Ingress annotations (e.g. `cert-manager.io/cluster-issuer`). |

### dashboard.config

Arbitrary key-value pairs injected into `opensearch_dashboards.yml`. Use this for SSO, custom plugins, etc.

---

## manager

Controls both the Wazuh Manager Master and Workers.

### manager.image

Repository: `wazuh/wazuh-manager`.

### manager.clusterKey

| Key | Default | Description |
|---|---|---|
| `manager.clusterKey` | `c98b62a9b6169ac5f67dae55ae4a9088` | 32-character hex key shared by all manager nodes to form a cluster. **Change before deploying.** Generate with: `openssl rand -hex 16`. |

### manager.api.credentials

| Key | Default | Description |
|---|---|---|
| `manager.api.credentials.username` | `wazuh-wui` | Wazuh API username used by the Dashboard. |
| `manager.api.credentials.password` | `MyS3cr37P450r.*-` | Wazuh API password. **Change before deploying.** |

### manager.authd

| Key | Default | Description |
|---|---|---|
| `manager.authd.pass` | `password` | Password agents must supply during enrollment. **Change before deploying.** |

### manager.master

| Key | Default | Description |
|---|---|---|
| `manager.master.storage.size` | `50Gi` | PVC size for the master node. |
| `manager.master.resources.*` | — | CPU/memory requests and limits for the master pod. |

### manager.worker

| Key | Default | Description |
|---|---|---|
| `manager.worker.replicas` | `2` | Number of worker pods. |
| `manager.worker.storage.size` | `50Gi` | PVC size per worker pod. |
| `manager.worker.loadBalancer.enabled` | `false` | Create an external LoadBalancer Service for agent traffic. |
| `manager.worker.podDisruptionBudget.enabled` | `true` | Enable PDB for workers. |
| `manager.worker.podDisruptionBudget.minAvailable` | `1` | Minimum available workers during disruptions. |

---

## agent

Controls the Wazuh Agent DaemonSet deployed on every cluster node.

| Key | Default | Description |
|---|---|---|
| `agent.enabled` | `true` | Deploy the agent DaemonSet. Set `false` to manage agents externally. |
| `agent.image.repository` | `kinseii/wazuh-agent` | Agent container image. |
| `agent.image.tag` | `4.14.1` | Agent image version. |
| `agent.resources.requests.cpu` | `50m` | CPU request (lightweight). |
| `agent.resources.requests.memory` | `64Mi` | Memory request. |
| `agent.resources.limits.cpu` | `100m` | CPU limit. |
| `agent.resources.limits.memory` | `128Mi` | Memory limit. |
| `agent.apiCredentials.username` | (same as manager API) | API user for agent auto-enrollment. |
| `agent.apiCredentials.password` | (same as manager API) | API password for agent auto-enrollment. |

---

## Common patterns across all components

These keys follow the same convention in every component section:

| Key pattern | Description |
|---|---|
| `*.nodeSelector` | Schedule pods only on matching nodes. |
| `*.tolerations` | Allow pods to run on tainted nodes. |
| `*.affinity` | Fine-grained scheduling rules (overrides default anti-affinity). |
| `*.extraEnv` | Extra environment variables injected into the main container. |
| `*.extraVolumes` | Additional volumes added to the pod spec. |
| `*.extraVolumeMounts` | Additional volume mounts in the main container. |
| `*.extraConf` | Extra configuration appended to the component's config file. |
| `*.extraSpec` | Raw YAML merged into the StatefulSet/Deployment spec. |
| `*.podAnnotations` | Annotations added to the pod metadata. |
| `*.podLabels` | Extra labels added to the pod metadata. |
| `*.serviceAccount.create` | Create a dedicated ServiceAccount. |
| `*.serviceAccount.name` | Override the ServiceAccount name. |
| `*.serviceAccount.annotations` | Annotations on the ServiceAccount (e.g. for IRSA). |
