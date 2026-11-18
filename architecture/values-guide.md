# Wazuh Helm — Values Guide

All parameters are set in `charts/wazuh/values.yaml`. Override with `-f custom-values.yaml` or `--set key=value`.

---

## 1. Global

| Parameter | Default | Description |
|---|---|---|
| `nameOverride` | `null` | Partially override component names |
| `fullnameOverride` | `null` | Fully override all component names |
| `autoreload.enabled` | `false` | Add config checksums to pod annotations for rolling restarts on change |
| `global.dualStack.enabled` | `false` | Enable dual-stack (IPv4+IPv6) networking |
| `global.dualStack.ipFamilyPolicy` | `""` | Kubernetes Service IP family policy |
| `global.networkPolicy.dns.to` | kube-dns selector | NetworkPolicy DNS egress targets |

---

## 2. cert-manager

| Parameter | Default | Description |
|---|---|---|
| `cert-manager.enabled` | `false` | Deploy cert-manager subchart |

All other `cert-manager.*` keys pass through to the official cert-manager chart.

---

## 3. Certificates

| Parameter | Default | Description |
|---|---|---|
| `certificates.enabled` | `true` | Deploy cert-manager Certificate resources |
| `certificates.requestPolicy.enabled` | `false` | Enable CertificateRequestPolicy |
| `certificates.issuer.name` | `null` | External issuer name (null = create SelfSigned chain) |
| `certificates.issuer.type` | `issuer` | `issuer` or `ClusterIssuer` |
| `certificates.duration` | `2160h` | Certificate validity (90 days) |
| `certificates.renewBefore` | `360h` | Renew threshold (15 days before expiry) |
| `certificates.subject.organization` | — | Cert subject org |
| `certificates.subject.country` | — | Cert subject country |
| `certificates.subject.locality` | — | Cert subject locality |

---

## 4. Indexer

| Parameter | Default | Description |
|---|---|---|
| `indexer.enabled` | `true` | Deploy Indexer StatefulSet |
| `indexer.replicas` | `3` | Number of Indexer pods (use odd numbers) |
| `indexer.storageSize` | `50Gi` | PVC size per Indexer pod |
| `indexer.storageClass` | `""` | StorageClass name (empty = cluster default) |
| `indexer.images.repository` | `wazuh/wazuh-indexer` | Image repository |
| `indexer.images.tag` | `4.14.10` | Image tag |
| `indexer.images.pullPolicy` | `IfNotPresent` | Image pull policy |
| `indexer.cred.existingSecret` | `""` | Existing Secret for Indexer credentials |
| `indexer.updateStrategy` | `RollingUpdate` | StatefulSet update strategy |
| `indexer.resources` | `{}` | CPU/memory requests and limits |
| `indexer.nodeSelector` | `{}` | Node selector |
| `indexer.tolerations` | `[]` | Tolerations |
| `indexer.affinity` | `{}` | Affinity rules |
| `indexer.snapshot.enabled` | `false` | Enable snapshot PVC |
| `indexer.snapshot.fs.size` | `50Gi` | Snapshot PVC size |
| `indexer.snapshot.fs.existingClaim` | `""` | Use existing PVC for snapshots |
| `indexer.job.annotations` | `{}` | Override securityadmin Job annotations |
| `indexer.job.resources` | `{}` | securityadmin Job container resources |
| `indexer.config.internalUsersExistingSecret` | `""` | External Secret for internal_users.yml |
| `indexer.ldap.enabled` | `false` | Enable LDAP authentication |
| `indexer.sysctlImage.enabled` | `false` | Run sysctl initContainer (vm.max_map_count) |

---

## 5. Dashboard

| Parameter | Default | Description |
|---|---|---|
| `dashboard.enabled` | `true` | Deploy Dashboard |
| `dashboard.replicas` | `1` | Number of Dashboard pods |
| `dashboard.images.repository` | `wazuh/wazuh-dashboard` | Image repository |
| `dashboard.images.tag` | `4.14.10` | Image tag |
| `dashboard.resources` | `{}` | CPU/memory requests and limits |
| `dashboard.ingress.enabled` | `false` | Enable Ingress |
| `dashboard.ingress.className` | `""` | Ingress class |
| `dashboard.ingress.host` | `""` | Ingress hostname |
| `dashboard.gateway.enabled` | `false` | Enable Gateway API (HTTPRoute) |
| `dashboard.sso.oidc.enabled` | `false` | Enable OIDC SSO |
| `dashboard.sso.oidc.existingSecret` | `""` | Secret with OIDC client ID and secret |

---

## 6. Wazuh Manager

### 6.1 Common

| Parameter | Default | Description |
|---|---|---|
| `wazuh.images.repository` | `wazuh/wazuh-manager` | Image repository |
| `wazuh.images.tag` | `4.14.10` | Image tag |
| `wazuh.authd.existingSecret` | `""` | Existing Secret for authd password |
| `wazuh.key` | `""` | Cluster key (use `wazuh.clusterKey.existingSecret` in production) |
| `wazuh.clusterKey.existingSecret` | `""` | External Secret for cluster key |
| `wazuh.api.certificate` | — | Manager API cert-manager Certificate config |
| `wazuh.api.gateway.enabled` | `false` | Expose Manager API via Gateway API |

### 6.2 Master

| Parameter | Default | Description |
|---|---|---|
| `wazuh.master.enabled` | `true` | Deploy Manager Master StatefulSet |
| `wazuh.master.storageSize` | `50Gi` | PVC size |
| `wazuh.master.storageClass` | `""` | StorageClass |
| `wazuh.master.resources` | `{}` | CPU/memory |
| `wazuh.master.nodeSelector` | `{}` | Node selector |
| `wazuh.master.tolerations` | `[]` | Tolerations |
| `wazuh.master.affinity` | `{}` | Affinity |

### 6.3 Workers

| Parameter | Default | Description |
|---|---|---|
| `wazuh.worker.enabled` | `true` | Deploy Manager Worker StatefulSet |
| `wazuh.worker.replicas` | `2` | Number of Worker pods |
| `wazuh.worker.storageSize` | `50Gi` | PVC size per Worker |
| `wazuh.worker.storageClass` | `""` | StorageClass |
| `wazuh.worker.resources` | `{}` | CPU/memory |

---

## 7. Agent

| Parameter | Default | Description |
|---|---|---|
| `agent.enabled` | `true` | Deploy Agent DaemonSet |
| `agent.images.repository` | — | Agent image repository |
| `agent.images.tag` | — | Agent image tag |
| `agent.images.pullPolicy` | `IfNotPresent` | Pull policy |
| `agent.resources` | `{}` | CPU/memory |
| `agent.nodeSelector` | `{}` | Node selector |
| `agent.tolerations` | `[]` | Tolerations (e.g. tolerate master nodes) |

---

## 8. Common Patterns

### Use external secrets (recommended for production)

```yaml
indexer:
  cred:
    existingSecret: my-indexer-cred
wazuh:
  authd:
    existingSecret: my-authd-pass
  clusterKey:
    existingSecret: my-cluster-key
```

### Enable cert-manager

```yaml
cert-manager:
  enabled: true
certificates:
  enabled: true
  duration: 8760h    # 1 year
  renewBefore: 720h  # 30 days
```

### Scale Indexer (always odd)

```yaml
indexer:
  replicas: 5
  storageSize: 100Gi
```

### Enable autoreload

```yaml
autoreload:
  enabled: true
```

### Expose Dashboard via Ingress

```yaml
dashboard:
  ingress:
    enabled: true
    className: nginx
    host: wazuh.example.com
```
