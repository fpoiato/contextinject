import {
  DescribeDBInstancesCommand,
  RDSClient,
  StartDBInstanceCommand,
  StopDBInstanceCommand,
} from "@aws-sdk/client-rds";

const rds = new RDSClient({});

function instanceId(): string {
  const id = process.env.DB_INSTANCE_ID;
  if (!id) {
    throw new Error("DB_INSTANCE_ID is not configured");
  }
  return id;
}

export async function dbStatus(): Promise<{ status: string; address?: string }> {
  const response = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: instanceId() }));
  const instance = response.DBInstances?.[0];
  return {
    status: instance?.DBInstanceStatus ?? "unknown",
    address: instance?.Endpoint?.Address,
  };
}

export async function startDb(): Promise<{ status: string; message: string }> {
  try {
    await rds.send(new StartDBInstanceCommand({ DBInstanceIdentifier: instanceId() }));
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (!name.includes("InvalidDBInstanceState")) {
      throw error;
    }
  }
  const current = await dbStatus();
  return { status: current.status, message: "Database start requested" };
}

export async function stopDb(): Promise<{ status: string; message: string }> {
  try {
    await rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier: instanceId() }));
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (!name.includes("InvalidDBInstanceState")) {
      throw error;
    }
  }
  const current = await dbStatus();
  return { status: current.status, message: "Database stop requested" };
}
