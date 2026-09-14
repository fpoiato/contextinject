from __future__ import annotations

import json
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    action = (event or {}).get("action") or "stop"
    instance_id = os.environ["DB_INSTANCE_ID"]
    client = boto3.client("rds")
    try:
        if action == "start":
            client.start_db_instance(DBInstanceIdentifier=instance_id)
            message = "Database start requested"
        else:
            client.stop_db_instance(DBInstanceIdentifier=instance_id)
            message = "Database stop requested"
        status = _status(client, instance_id)
        return {"ok": True, "message": message, "status": status}
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code in {"InvalidDBInstanceState", "InvalidDBInstanceStateFault"}:
            status = _status(client, instance_id)
            return {"ok": True, "message": "Database already in the desired state", "status": status}
        raise


def _status(client: Any, instance_id: str) -> str:
    info = client.describe_db_instances(DBInstanceIdentifier=instance_id)
    return info["DBInstances"][0]["DBInstanceStatus"]
