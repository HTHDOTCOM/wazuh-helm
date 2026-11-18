# Runbook: Scaling

## Indexer Scaling

### Rules

- Always use **odd replica counts** (1, 3, 5, 7…) to maintain OpenSearch quorum
- Minimum recommended: 3
- Never scale below the current `minimum_master_nodes` threshold

### Scale Up

```bash
# Via helm upgrade
helm upgrade <release> charts/wazuh \
  --reuse-values \
  --set indexer.replicas=5 \
  -n <namespace>

# Monitor rollout
kubectl rollout status statefulset/<name>-indexer -n <namespace>

# Verify cluster health after each new node joins
kubectl exec -n <namespace> <name>-indexer-0 -- \
  curl -sk -u admin:$INDEXER_PASSWORD \
  https://localhost:9200/_cluster/health?pretty
```

### Scale Down

Scale down requires moving shards off the nodes being removed first.

```bash
# Step 1: Exclude nodes being removed from shard allocation
# (replace N with the index of the last node being removed, e.g. 2 for 5→3)
kubectl exec -n <namespace> <name>-indexer-0 -- \
  curl -sk -u admin:$INDEXER_PASSWORD \
  -X PUT https://localhost:9200/_cluster/settings \
  -H 'Content-Type: application/json' \
  -d '{"persistent":{"cluster.routing.allocation.exclude._name":"<name>-indexer-2,<name>-indexer-3"}}'

# Step 2: Wait for shards to migrate (health turns green)
kubectl exec -n <namespace> <name>-indexer-0 -- \
  curl -sk -u admin:$INDEXER_PASSWORD \
  https://localhost:9200/_cluster/health?pretty

# Step 3: Scale down
helm upgrade <release> charts/wazuh \
  --reuse-values \
  --set indexer.replicas=3 \
  -n <namespace>

# Step 4: Clear exclusion
kubectl exec -n <namespace> <name>-indexer-0 -- \
  curl -sk -u admin:$INDEXER_PASSWORD \
  -X PUT https://localhost:9200/_cluster/settings \
  -H 'Content-Type: application/json' \
  -d '{"persistent":{"cluster.routing.allocation.exclude._name":null}}'
```

---

## Manager Worker Scaling

### Scale Up

```bash
helm upgrade <release> charts/wazuh \
  --reuse-values \
  --set wazuh.worker.replicas=3 \
  -n <namespace>

kubectl rollout status statefulset/<name>-manager-worker -n <namespace>
```

### Scale Down

Workers are stateful. Before scaling down, ensure no agents are exclusively connected to the pod being removed — agents reconnect automatically.

```bash
helm upgrade <release> charts/wazuh \
  --reuse-values \
  --set wazuh.worker.replicas=1 \
  -n <namespace>
```

---

## Dashboard Scaling

Dashboard is stateless. Scale freely:

```bash
helm upgrade <release> charts/wazuh \
  --reuse-values \
  --set dashboard.replicas=2 \
  -n <namespace>
```

---

## PodDisruptionBudget Awareness

| Component | minAvailable | Impact |
|---|---|---|
| Indexer | 2 | Cannot drain >1 Indexer node at a time in a 3-node cluster |
| Manager Worker | 1 | Cannot drain all workers simultaneously |
| Dashboard | 1 | Cannot drain all Dashboard pods simultaneously |

When draining a node, ensure PDB constraints are respected:

```bash
# Check PDB status before draining
kubectl get pdb -n <namespace>

# Drain node (Kubernetes respects PDBs automatically)
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
```
