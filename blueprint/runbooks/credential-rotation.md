# Runbook — Credential Rotation

All default credentials **must** be changed before production deployment.  
This runbook covers rotating each secret after initial deployment.

---

## 1. Indexer Admin Password

```bash
# 1. Update the Helm release
helm upgrade wazuh charts/wazuh \
  --reuse-values \
  --set indexer.secret.password=<new-password> \
  -n <namespace>

# 2. Update the internal OpenSearch user via the security API
kubectl exec -it wazuh-indexer-0 -n <namespace> -- \
  curl -sk -X PUT https://localhost:9200/_plugins/_security/api/internalusers/admin \
  -H 'Content-Type: application/json' \
  -u admin:<old-password> \
  -d '{"password":"<new-password>","backend_roles":["admin"]}'

# 3. Restart all pods that use this credential
kubectl rollout restart statefulset/wazuh-manager-master -n <namespace>
kubectl rollout restart statefulset/wazuh-manager-worker -n <namespace>
kubectl rollout restart deployment/wazuh-dashboard -n <namespace>
```

---

## 2. Dashboard kibanaserver Password

```bash
helm upgrade wazuh charts/wazuh \
  --reuse-values \
  --set dashboard.secret.password=<new-password> \
  -n <namespace>

# Also update the internal OpenSearch user
kubectl exec -it wazuh-indexer-0 -n <namespace> -- \
  curl -sk -X PUT https://localhost:9200/_plugins/_security/api/internalusers/kibanaserver \
  -H 'Content-Type: application/json' \
  -u admin:<admin-password> \
  -d '{"password":"<new-password>"}'

kubectl rollout restart deployment/wazuh-dashboard -n <namespace>
```

---

## 3. Wazuh Manager API Password

```bash
helm upgrade wazuh charts/wazuh \
  --reuse-values \
  --set manager.api.credentials.password=<new-password> \
  --set agent.apiCredentials.password=<new-password> \
  -n <namespace>

kubectl rollout restart statefulset/wazuh-manager-master -n <namespace>
kubectl rollout restart daemonset/wazuh-agent -n <namespace>
```

---

## 4. Manager Cluster Key

The cluster key must be identical on master and all workers. Changing it requires a coordinated restart.

```bash
# Generate a new key
NEW_KEY=$(openssl rand -hex 16)
echo $NEW_KEY

helm upgrade wazuh charts/wazuh \
  --reuse-values \
  --set manager.clusterKey=$NEW_KEY \
  -n <namespace>

# Restart master first, then workers
kubectl rollout restart statefulset/wazuh-manager-master -n <namespace>
kubectl rollout status statefulset/wazuh-manager-master -n <namespace>
kubectl rollout restart statefulset/wazuh-manager-worker -n <namespace>
```

---

## 5. Agent Authd Password

```bash
helm upgrade wazuh charts/wazuh \
  --reuse-values \
  --set manager.authd.pass=<new-password> \
  -n <namespace>

kubectl rollout restart statefulset/wazuh-manager-master -n <namespace>
```

Agents already enrolled are not affected — only new enrollments use this password.
