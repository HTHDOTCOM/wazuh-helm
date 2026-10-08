#!/usr/bin/env python3
"""Generate the local Wazuh 4 smoke profile without changing chart defaults.
Requires Helm 3, installed chart dependencies and PyYAML.
"""
import argparse
import os
from pathlib import Path
import re
import subprocess
import yaml

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
PROFILE = r"""
agent:
  serviceAccount:
    create: true
autoreload:
  enabled: true
cert-manager:
  enabled: false
dashboard:
  serviceAccount:
    create: true
indexer:
  replicas: 1
  resources:
    limits:
      cpu: 1500m
      memory: 3Gi
    requests:
      cpu: 250m
      memory: 1Gi
  serviceAccount:
    create: true
  storageSize: 5Gi
wazuh:
  master:
    readinessProbe:
      exec:
        command:
        - sh
        - -c
        - pgrep -x wazuh-analysisd >/dev/null && test "$(curl --max-time 3 -sS --cacert
          /var/ossec/api/configuration/ssl/server.crt -o /dev/null -w "%{http_code}"
          https://localhost:55000/)" = 401
      failureThreshold: 6
      initialDelaySeconds: 30
      periodSeconds: 10
      timeoutSeconds: 5
    resources:
      limits:
        cpu: 1000m
        memory: 4Gi
      requests:
        cpu: 500m
        memory: 1Gi
    storageSize: 5Gi
  serviceAccount:
    create: true
  worker:
    readinessProbe:
      exec:
        command:
        - sh
        - -c
        - pgrep -x wazuh-analysisd >/dev/null && test "$(curl --max-time 3 -sS --cacert
          /var/ossec/api/configuration/ssl/server.crt -o /dev/null -w "%{http_code}"
          https://localhost:55000/)" = 401
      failureThreshold: 6
      initialDelaySeconds: 30
      periodSeconds: 10
      timeoutSeconds: 5
    replicas: 1
    resources:
      limits:
        cpu: 1000m
        memory: 4Gi
      requests:
        cpu: 500m
        memory: 1Gi
    storageSize: 5Gi
"""
profile = yaml.safe_load(PROFILE)
rendered = subprocess.run(["helm", "template", "wazuh", str(root / "charts/wazuh"),
                           "--namespace", "wazuh-test"], check=True, capture_output=True, text=True).stdout
config = next(d["data"] for d in yaml.safe_load_all(rendered)
              if d and d["kind"] == "ConfigMap" and d["metadata"]["name"] == "wazuh-manager-config")
for role in ["master", "worker"]:
    text = config[role + ".conf"].replace("<queue_size>131072</queue_size>", "<queue_size>4096</queue_size>")
    profile["wazuh"][role + "Conf"] = re.sub(r"(<vulnerability-detection>\s*<enabled>)yes", r"\1no", text)
text = (root / "charts/wazuh/files/internal_options.conf").read_text()
profile["wazuh"]["internalOptions"] = re.sub(r"^(analysisd\.[a-z_]+threads)=0$", r"\1=1", text, flags=re.M)
# Refuse to overwrite an existing file; generated values contain chart defaults.
with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
    yaml.safe_dump(profile, handle, sort_keys=False)
