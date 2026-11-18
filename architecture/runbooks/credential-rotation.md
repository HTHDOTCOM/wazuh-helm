# Runbook: Credential Rotation

## Overview

There are 5 credential Secrets to rotate. Rotate them one at a time and restart affected components after each.

| Secret | Key(s) | Affects |
|---|---|---|
| `indexer-cred` | INDEXER_USERNAME, INDEXER_PASSWORD | Indexer, Manager, Dashboard |
| `dashboard-cred` | DASHBOARD_USERNAME, DASHBOARD_PASSWORD | Dashboard |
| `wazuh-api-cred` | WAZUH_API_USER, WAZUH_API_PASSWORD | Manager, Dashboard, Agent |
| `wazuh-authd-pass` | password | Manager Master, Agent |
| `wazuh-cluster-key` | key | Manager Master + Workers |

---

## 1. Rotate Indexer Credentials (`indexer-cred`)

The indexer service account is `wazuh-server` in Wazuh 5.0 (was `admin` in 4.x).

```bash
NEW_PASSWORD="$(openssl rand -base64 32)"

# Update the internal_users.yml via securityconfig Secret or Helm values
# Then update the credential Secret
kubectl create secret generic indexer-cred \
  --from-literal=INDEXER_USERNAME=wazuh-server \
  --from-literal=INDEXER_PASSWORD="$NEW_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f - -n <namespace>

# Restart all components that use it
kubectl rollout restart statefulset/<name>-indexer -n <namespace>
kubectl rollout restart statefulset/<name>-manager-master -n <namespace>
kubectl rollout restart statefulset/<name>-manager-worker -n <namespace>
kubectl rollout restart deployment/<name>-dashboard -n <namespace>
```

---

## 2. Rotate Dashboard Credentials (`dashboard-cred`)

```bash
NEW_PASSWORD="$(openssl rand -base64 32)"

kubectl create secret generic dashboard-cred \
  --from-literal=DASHBOARD_USERNAME=kibanaserver \
  --from-literal=DASHBOARD_PASSWORD="$NEW_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f - -n <namespace>

kubectl rollout restart deployment/<name>-dashboard -n <namespace>
```

---

## 3. Rotate Wazuh API Credentials (`wazuh-api-cred`)

```bash
NEW_USER="wazuh-wui"
NEW_PASSWORD="$(openssl rand -base64 32)"

kubectl create secret generic wazuh-api-cred \
  --from-literal=WAZUH_API_USER="$NEW_USER" \
  --from-literal=WAZUH_API_PASSWORD="$NEW_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f - -n <namespace>

# Update the user inside the Manager as well (via API or config)
kubectl rollout restart statefulset/<name>-manager-master -n <namespace>
kubectl rollout restart statefulset/<name>-manager-worker -n <namespace>
kubectl rollout restart deployment/<name>-dashboard -n <namespace>
```

---

## 4. Rotate Agent Enrollment Password (`wazuh-authd-pass`)

```bash
NEW_PASSWORD="$(openssl rand -base64 24)"

kubectl create secret generic wazuh-authd-pass \
  --from-literal=password="$NEW_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f - -n <namespace>

# Restart Manager Master (reads the secret on startup)
kubectl rollout restart statefulset/<name>-manager-master -n <namespace>
kubectl rollout status statefulset/<name>-manager-master -n <namespace>

# Restart Agent DaemonSet (agents re-enroll with new password)
kubectl rollout restart daemonset/<name>-agent -n <namespace>
```

---

## 5. Rotate Cluster Key (`wazuh-cluster-key`)

The cluster key must be identical on Master and all Workers. Rotating it requires a coordinated restart.

```bash
# Generate a new 32-character hex key
NEW_KEY="$(openssl rand -hex 16)"

kubectl create secret generic wazuh-cluster-key \
  --from-literal=key="$NEW_KEY" \
  --dry-run=client -o yaml | kubectl apply -f - -n <namespace>

# Restart Master first, then Workers
kubectl rollout restart statefulset/<name>-manager-master -n <namespace>
kubectl rollout status statefulset/<name>-manager-master -n <namespace>

kubectl rollout restart statefulset/<name>-manager-worker -n <namespace>
kubectl rollout status statefulset/<name>-manager-worker -n <namespace>
```

---

## Verification

```bash
# Check Indexer cluster is green
kubectl exec -n <namespace> <name>-indexer-0 -- \
  curl -sk -u wazuh-server:$NEW_INDEXER_PASSWORD \
  https://localhost:9200/_cluster/health | jq .status

# Check Manager cluster status (path updated for Wazuh 5.0)
kubectl exec -n <namespace> <name>-manager-master-0 -- \
  /var/ossec/bin/cluster_control -l

# Check Dashboard can reach Indexer and Manager API
kubectl logs -n <namespace> deploy/<name>-dashboard --tail=50
```
