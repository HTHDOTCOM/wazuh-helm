# Runbook — TLS Certificate Rotation

## When to use

- A certificate is nearing expiry and auto-renewal has not triggered.
- You are rotating the root CA.
- cert-manager is disabled and you manage certificates manually.

---

## 1. Check current certificate status

```bash
# List all Certificate objects
kubectl get certificates -n <namespace>

# Check a specific cert
kubectl describe certificate wazuh-indexer-cert -n <namespace>
```

Look for `Status: Ready = True` and check the `Not After` field on the underlying Secret:

```bash
kubectl get secret wazuh-indexer-cert -n <namespace> -o jsonpath='{.data.tls\.crt}' \
  | base64 -d | openssl x509 -noout -dates
```

---

## 2. Force renewal (cert-manager managed)

```bash
# Annotate the certificate to trigger immediate renewal
kubectl annotate certificate wazuh-indexer-cert \
  cert-manager.io/issuer-kind=Issuer \
  --overwrite -n <namespace>

# Or delete the Secret — cert-manager will re-issue
kubectl delete secret wazuh-indexer-cert -n <namespace>
```

cert-manager will re-create the Secret and all pods that mount it will pick up the new cert on the next restart.

---

## 3. Rolling restart after cert renewal

```bash
kubectl rollout restart statefulset/wazuh-indexer -n <namespace>
kubectl rollout restart deployment/wazuh-dashboard -n <namespace>
kubectl rollout restart statefulset/wazuh-manager-master -n <namespace>
kubectl rollout restart statefulset/wazuh-manager-worker -n <namespace>
```

---

## 4. Verify

```bash
# Check the indexer is healthy
kubectl exec -it wazuh-indexer-0 -n <namespace> -- \
  curl -sk https://localhost:9200 -u admin:<password> | jq .

# Check dashboard is serving HTTPS
kubectl port-forward svc/wazuh-dashboard 5601:5601 -n <namespace> &
curl -sk https://localhost:5601 | grep -i wazuh
```
