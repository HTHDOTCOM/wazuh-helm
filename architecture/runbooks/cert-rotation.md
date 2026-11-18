# Runbook: TLS Certificate Rotation

## When to Use

- Certificate expiry approaching (check `renewBefore` threshold)
- Security incident requiring immediate rotation
- CA compromise

---

## Option A — cert-manager Managed (Recommended)

cert-manager auto-renews certificates before `renewBefore`. To force immediate renewal:

```bash
# List all certificates
kubectl get certificates -n <namespace>

# Force renewal of a specific cert
kubectl annotate certificate node-tls \
  cert-manager.io/issuer-name- \
  -n <namespace>

# Or delete and let cert-manager recreate
kubectl delete secret node-tls -n <namespace>
# cert-manager will issue a new cert within seconds
```

After rotation, restart affected workloads:

```bash
# Restart Indexer (rolling)
kubectl rollout restart statefulset/<name>-indexer -n <namespace>

# Restart Manager Master
kubectl rollout restart statefulset/<name>-manager-master -n <namespace>

# Restart Manager Workers
kubectl rollout restart statefulset/<name>-manager-worker -n <namespace>

# Restart Dashboard
kubectl rollout restart deployment/<name>-dashboard -n <namespace>
```

---

## Option B — Manual Certificate Rotation

### Step 1: Generate new certificates

Use openssl or cfssl to generate new certs signed by your CA.

```bash
# Example: regenerate node cert
openssl req -new -newkey rsa:4096 -nodes \
  -keyout node.key -out node.csr \
  -subj "/CN=wazuh-indexer/O=Wazuh"

openssl x509 -req -in node.csr \
  -CA root-ca.pem -CAkey root-ca-key.pem \
  -CAcreateserial -out node.crt -days 365
```

### Step 2: Update the Kubernetes Secret

```bash
kubectl create secret tls node-tls \
  --cert=node.crt --key=node.key \
  --dry-run=client -o yaml | \
  kubectl apply -f - -n <namespace>
```

### Step 3: Re-run securityadmin Job

After rotating `node-tls` or `admin-tls`, trigger the securityadmin Job:

```bash
# Delete the old completed job (hook-delete-policy handles this on upgrade)
kubectl delete job <name>-indexer-securityadmin -n <namespace>

# Trigger via helm upgrade (no-op values change)
helm upgrade <release> charts/wazuh \
  --reuse-values \
  --set indexer.job.annotations."helm\.sh/hook"=post-upgrade \
  -n <namespace>
```

### Step 4: Verify

```bash
# Check cert expiry on running Indexer pod
kubectl exec -n <namespace> <name>-indexer-0 -- \
  openssl x509 -in /usr/share/wazuh-indexer/config/certs/node.pem \
  -noout -dates

# Check Dashboard TLS
kubectl exec -n <namespace> deploy/<name>-dashboard -- \
  openssl x509 -in /usr/share/wazuh-dashboard/config/certs/dashboard.pem \
  -noout -dates
```

---

## Rotate Root CA

Rotating the root CA requires rotating all leaf certs. Plan for downtime or use rolling rotation.

```bash
# 1. Delete the SelfSigned Issuer chain (cert-manager will recreate)
kubectl delete certificate root-ca -n <namespace>
kubectl delete secret root-ca-tls -n <namespace>

# cert-manager recreates root-ca → CA Issuer → all leaf certs

# 2. Wait for all certs to be Ready
kubectl get certificates -n <namespace> -w

# 3. Rolling restart all components
for resource in \
  statefulset/<name>-indexer \
  statefulset/<name>-manager-master \
  statefulset/<name>-manager-worker; do
  kubectl rollout restart $resource -n <namespace>
  kubectl rollout status $resource -n <namespace>
done
kubectl rollout restart deployment/<name>-dashboard -n <namespace>
```
