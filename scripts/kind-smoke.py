#!/usr/bin/env python3
"""Functional checks for the dedicated workspace cluster; never prints credentials."""
import json
import subprocess
import os
import shutil

KUBECTL = shutil.which("kubectl")
assert KUBECTL, "kubectl must be on PATH"
BASE = [KUBECTL, "--kubeconfig", os.environ["KUBECONFIG"],
        "--context", "kind-wazuh-dev", "-n", "wazuh-test"]

def run(*args, input=None):
    return subprocess.run(BASE + list(args), input=input, text=True,
                          capture_output=True, check=True, timeout=60).stdout

pods = json.loads(run("get", "pods", "-o", "json"))["items"]
for pod in pods:
    if pod["metadata"].get("deletionTimestamp") or pod["status"].get("phase") == "Succeeded":
        continue
    statuses = pod["status"].get("containerStatuses", [])
    assert statuses and all(s["ready"] for s in statuses), pod["metadata"]["name"]
    if pod["metadata"]["name"].startswith("wazuh-manager-"):
        assert all(s["restartCount"] == 0 for s in statuses), "Manager restarted"
print("All application pods Ready; current managers have zero restarts")

script = '''
import os, json, requests
base = "https://localhost:55000"
ca = "/var/ossec/api/configuration/ssl/server.crt"
r = requests.post(base+"/security/user/authenticate", auth=(os.environ["API_USERNAME"], os.environ["API_PASSWORD"]), verify=ca, timeout=20)
r.raise_for_status()
headers = {"Authorization": "Bearer " + r.json()["data"]["token"]}
r = requests.get(base+"/agents?select=id,name,status,version", headers=headers, verify=ca, timeout=20)
r.raise_for_status()
agents = r.json()["data"]["affected_items"]
assert any(a["id"] != "000" and a["status"] == "active" for a in agents), "No connected agent"
print("Manager API authenticated; test agent connected")
'''
print(run("exec", "-i", "wazuh-manager-master-0", "--",
          "/var/ossec/framework/python/bin/python3", "-", input=script).strip())

curl = ('curl --max-time 20 -fsS --resolve wazuh-indexer:9200:127.0.0.1 '
        '--cacert /usr/share/wazuh-indexer/config/certs/root-ca.pem '
        '-u "$INDEXER_USERNAME:$INDEXER_PASSWORD" ')
health = json.loads(run("exec", "wazuh-indexer-0", "--", "sh", "-c",
                        curl + "https://wazuh-indexer:9200/_cluster/health"))
assert health["status"] == "green", health["status"]
print("Authenticated indexer health: green")
count = json.loads(run("exec", "wazuh-indexer-0", "--", "sh", "-c",
                      curl + '--get --data-urlencode \'q=full_log:"codex-kind-smoke-final"\' '
                      'https://wazuh-indexer:9200/wazuh-alerts-*/_count'))
assert count["count"] >= 1, "Smoke alert not indexed"
print("Synthetic SSH failure alert indexed")
status = json.loads(run("exec", "deployment/wazuh-dashboard", "--", "curl",
                        "--max-time", "20", "-fsS", "http://localhost:5601/api/status"))
assert status["status"]["overall"]["state"] == "green"
print("Dashboard health: green")
