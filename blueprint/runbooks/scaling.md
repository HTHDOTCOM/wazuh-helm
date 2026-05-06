# Runbook — Scaling Indexer and Manager Workers

## Scale Indexer (OpenSearch nodes)

Indexer replicas must always be an **odd number** (3, 5, 7) to maintain quorum.

```bash
# Scale via Helm upgrade
helm upgrade wazuh charts/wazuh \
  --reuse-values \
  --set indexer.replicas=5 \
  -n <namespace>
```

After scaling, verify cluster health:

```bash
kubectl exec -it wazuh-indexer-0 -n <namespace> -- \
  curl -sk https://localhost:9200/_cluster/health?pretty \
  -u admin:<password>
```

Expected: `"status": "green"` and `"number_of_nodes": 5`.

---

## Scale Manager Workers

Workers are stateless with respect to the indexer — they can be scaled freely.

```bash
helm upgrade wazuh charts/wazuh \
  --reuse-values \
  --set manager.worker.replicas=4 \
  -n <namespace>
```

Agents will reconnect automatically to the load-balanced worker Service.

---

## Scale down considerations

- **Indexer:** Before scaling down, ensure no shards are allocated only on the node being removed.
  ```bash
  # Exclude the node being removed from shard allocation
  kubectl exec -it wazuh-indexer-0 -n <namespace> -- curl -sk -X PUT \
    https://localhost:9200/_cluster/settings \
    -H 'Content-Type: application/json' \
    -u admin:<password> \
    -d '{"transient":{"cluster.routing.allocation.exclude._name":"wazuh-indexer-2"}}'
  ```
  Wait for `_cluster/health` to show `"relocating_shards": 0`, then scale down.

- **Manager workers:** Agents on removed workers will reconnect automatically within the reconnection timeout (default 60s).
