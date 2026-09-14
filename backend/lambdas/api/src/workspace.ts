import { randomUUID } from "node:crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { DeleteObjectCommand, DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HttpError } from "./auth.js";
import { query } from "./db.js";
import { planFor } from "./plans.js";

const s3 = new S3Client({});
const lambda = new LambdaClient({});

function bucket(): string {
  const name = process.env.DOCUMENTS_BUCKET;
  if (!name) {
    throw new Error("DOCUMENTS_BUCKET is not configured");
  }
  return name;
}

function cleanName(value: string, fallback: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, 120);
  return trimmed || fallback;
}

export interface Usage {
  bytes: number;
  limitBytes: number;
  documents: number;
}

export async function usageFor(userId: string): Promise<Usage> {
  const result = await query<{ plan: string | null; bytes: string | null; documents: string }>(
    `
    SELECT u.plan,
           (SELECT COALESCE(SUM(bytes), 0) FROM documents WHERE user_id = u.id) AS bytes,
           (SELECT COUNT(*) FROM documents WHERE user_id = u.id) AS documents
    FROM users u WHERE u.id = $1
    `,
    [userId],
  );
  const row = result.rows[0];
  return {
    bytes: Number(row?.bytes ?? 0),
    limitBytes: planFor(row?.plan).storageBytes,
    documents: Number(row?.documents ?? 0),
  };
}

export async function listProjects(userId: string) {
  const result = await query(
    `
    SELECT p.id, p.name, p.created_at,
           (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id) AS document_count,
           (SELECT COALESCE(SUM(bytes), 0) FROM documents d WHERE d.project_id = p.id) AS bytes
    FROM projects p
    WHERE p.user_id = $1
    ORDER BY p.created_at
    `,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    documentCount: Number(row.document_count),
    bytes: Number(row.bytes),
  }));
}

export async function createProject(userId: string, name: string) {
  const cleaned = cleanName(name, "New project");
  const existing = await query<{ id: string }>(`SELECT id FROM projects WHERE user_id = $1 AND name = $2`, [userId, cleaned]);
  if (existing.rowCount) {
    throw new HttpError(409, "A project with this name already exists");
  }
  const result = await query<{ id: string; name: string; created_at: string }>(
    `INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at`,
    [userId, cleaned],
  );
  const row = result.rows[0];
  return { id: row.id, name: row.name, createdAt: row.created_at, documentCount: 0, bytes: 0 };
}

async function ownedProject(userId: string, projectId: string): Promise<void> {
  const result = await query<{ id: string }>(`SELECT id FROM projects WHERE id = $1 AND user_id = $2`, [projectId, userId]);
  if (!result.rowCount) {
    throw new HttpError(404, "Project not found");
  }
}

export async function renameProject(userId: string, projectId: string, name: string) {
  await ownedProject(userId, projectId);
  const cleaned = cleanName(name, "Project");
  const result = await query<{ id: string; name: string; created_at: string }>(
    `UPDATE projects SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING id, name, created_at`,
    [projectId, userId, cleaned],
  );
  const row = result.rows[0];
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    if (batch.length === 1) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: batch[0] }));
    } else if (batch.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
    }
  }
}

export async function deleteProject(userId: string, projectId: string): Promise<void> {
  await ownedProject(userId, projectId);
  const docs = await query<{ s3_key: string }>(`SELECT s3_key FROM documents WHERE project_id = $1 AND user_id = $2`, [projectId, userId]);
  await deleteObjects(docs.rows.map((row) => row.s3_key));
  await query(`DELETE FROM projects WHERE id = $1 AND user_id = $2`, [projectId, userId]);
}

export async function projectTree(userId: string, projectId: string) {
  await ownedProject(userId, projectId);
  const [folders, documents] = await Promise.all([
    query(`SELECT id, parent_id, name, created_at FROM folders WHERE project_id = $1 ORDER BY name`, [projectId]),
    query(
      `
      SELECT id, folder_id, filename, content_type, status, bytes, error, created_at, updated_at
      FROM documents
      WHERE project_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      `,
      [projectId, userId],
    ),
  ]);
  return {
    folders: folders.rows.map((row) => ({ id: row.id, parentId: row.parent_id, name: row.name, createdAt: row.created_at })),
    documents: documents.rows.map((row) => ({
      id: row.id,
      folderId: row.folder_id,
      filename: row.filename,
      contentType: row.content_type,
      status: row.status,
      bytes: row.bytes === null ? null : Number(row.bytes),
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

async function folderInProject(projectId: string, folderId: string | null): Promise<void> {
  if (!folderId) {
    return;
  }
  const result = await query<{ id: string }>(`SELECT id FROM folders WHERE id = $1 AND project_id = $2`, [folderId, projectId]);
  if (!result.rowCount) {
    throw new HttpError(404, "Folder not found in this project");
  }
}

export async function createFolder(userId: string, projectId: string, name: string, parentId: string | null) {
  await ownedProject(userId, projectId);
  await folderInProject(projectId, parentId);
  const result = await query<{ id: string; parent_id: string | null; name: string; created_at: string }>(
    `INSERT INTO folders (project_id, parent_id, name) VALUES ($1, $2, $3) RETURNING id, parent_id, name, created_at`,
    [projectId, parentId, cleanName(name, "New folder")],
  );
  const row = result.rows[0];
  return { id: row.id, parentId: row.parent_id, name: row.name, createdAt: row.created_at };
}

async function ownedFolder(userId: string, folderId: string): Promise<{ project_id: string }> {
  const result = await query<{ project_id: string }>(
    `SELECT f.project_id FROM folders f JOIN projects p ON p.id = f.project_id WHERE f.id = $1 AND p.user_id = $2`,
    [folderId, userId],
  );
  if (!result.rowCount) {
    throw new HttpError(404, "Folder not found");
  }
  return result.rows[0];
}

export async function updateFolder(
  userId: string,
  folderId: string,
  changes: { name?: string; parentId?: string | null },
) {
  const { project_id: projectId } = await ownedFolder(userId, folderId);
  if (changes.parentId !== undefined) {
    if (changes.parentId === folderId) {
      throw new HttpError(400, "A folder cannot be its own parent");
    }
    await folderInProject(projectId, changes.parentId);
    if (changes.parentId) {
      const cycle = await query<{ id: string }>(
        `
        WITH RECURSIVE sub AS (
          SELECT id FROM folders WHERE id = $1
          UNION ALL
          SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
        )
        SELECT id FROM sub WHERE id = $2
        `,
        [folderId, changes.parentId],
      );
      if (cycle.rowCount) {
        throw new HttpError(400, "Cannot move a folder into its own subfolder");
      }
    }
  }
  const result = await query<{ id: string; parent_id: string | null; name: string; created_at: string }>(
    `
    UPDATE folders
    SET name = COALESCE($2, name),
        parent_id = CASE WHEN $3::boolean THEN $4::uuid ELSE parent_id END
    WHERE id = $1
    RETURNING id, parent_id, name, created_at
    `,
    [folderId, changes.name === undefined ? null : cleanName(changes.name, "Folder"), changes.parentId !== undefined, changes.parentId ?? null],
  );
  const row = result.rows[0];
  return { id: row.id, parentId: row.parent_id, name: row.name, createdAt: row.created_at };
}

export async function deleteFolder(userId: string, folderId: string): Promise<void> {
  await ownedFolder(userId, folderId);
  const docs = await query<{ s3_key: string }>(
    `
    WITH RECURSIVE sub AS (
      SELECT id FROM folders WHERE id = $1
      UNION ALL
      SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
    )
    SELECT s3_key FROM documents WHERE folder_id IN (SELECT id FROM sub)
    `,
    [folderId],
  );
  await deleteObjects(docs.rows.map((row) => row.s3_key));
  await query(
    `
    WITH RECURSIVE sub AS (
      SELECT id FROM folders WHERE id = $1
      UNION ALL
      SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
    )
    DELETE FROM documents WHERE folder_id IN (SELECT id FROM sub)
    `,
    [folderId],
  );
  await query(`DELETE FROM folders WHERE id = $1`, [folderId]);
}

export async function presignUpload(
  userId: string,
  projectId: string,
  input: { filename: string; contentType: string; size: number; folderId: string | null },
) {
  await ownedProject(userId, projectId);
  await folderInProject(projectId, input.folderId);
  const filename = cleanName(input.filename, "document.bin").replace(/[^\w.\- ()\u00C0-\u024F]/g, "_");
  const size = Number.isFinite(input.size) && input.size > 0 ? Math.floor(input.size) : 0;

  const planRow = await query<{ plan: string | null }>(`SELECT plan FROM users WHERE id = $1`, [userId]);
  const plan = planFor(planRow.rows[0]?.plan);
  if (size > plan.maxUploadBytes) {
    throw new HttpError(413, `Files on the ${plan.name} plan are limited to ${Math.round(plan.maxUploadBytes / 1024 ** 2)} MB`, "FILE_TOO_LARGE");
  }
  const usage = await usageFor(userId);
  if (usage.bytes + size > plan.storageBytes) {
    throw new HttpError(
      402,
      `Storage limit reached for the ${plan.name} plan. Delete documents or upgrade your plan.`,
      "QUOTA_EXCEEDED",
    );
  }

  const documentId = randomUUID();
  const key = `uploads/${userId}/${projectId}/${documentId}/${filename}`;
  await query(
    `
    INSERT INTO documents (id, user_id, project_id, folder_id, filename, content_type, s3_key, status, bytes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
    `,
    [documentId, userId, projectId, input.folderId, filename, input.contentType, key, size || null],
  );
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: input.contentType }),
    { expiresIn: 900 },
  );
  return { url, key, documentId, filename, contentType: input.contentType };
}

export async function completeUpload(userId: string, documentId: string) {
  const result = await query<{ id: string; s3_key: string; filename: string; content_type: string | null; project_id: string }>(
    `SELECT id, s3_key, filename, content_type, project_id FROM documents WHERE id = $1 AND user_id = $2`,
    [documentId, userId],
  );
  const doc = result.rows[0];
  if (!doc) {
    throw new HttpError(404, "Document not found");
  }
  await query(`UPDATE documents SET status = 'processing', error = NULL, updated_at = now() WHERE id = $1`, [documentId]);
  await lambda.send(
    new InvokeCommand({
      FunctionName: process.env.INGEST_FUNCTION_NAME,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({ document_id: doc.id })),
    }),
  );
  return { ok: true, status: "processing", documentId };
}

async function ownedDocument(userId: string, documentId: string) {
  const result = await query<{ id: string; s3_key: string; project_id: string }>(
    `SELECT id, s3_key, project_id FROM documents WHERE id = $1 AND user_id = $2`,
    [documentId, userId],
  );
  if (!result.rowCount) {
    throw new HttpError(404, "Document not found");
  }
  return result.rows[0];
}

export async function updateDocument(
  userId: string,
  documentId: string,
  changes: { filename?: string; folderId?: string | null },
) {
  const doc = await ownedDocument(userId, documentId);
  if (changes.folderId !== undefined) {
    await folderInProject(doc.project_id, changes.folderId);
  }
  const result = await query(
    `
    UPDATE documents
    SET filename = COALESCE($2, filename),
        folder_id = CASE WHEN $3::boolean THEN $4::uuid ELSE folder_id END,
        updated_at = now()
    WHERE id = $1
    RETURNING id, folder_id, filename, content_type, status, bytes, error, created_at, updated_at
    `,
    [documentId, changes.filename === undefined ? null : cleanName(changes.filename, "document"), changes.folderId !== undefined, changes.folderId ?? null],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    folderId: row.folder_id,
    filename: row.filename,
    contentType: row.content_type,
    status: row.status,
    bytes: row.bytes === null ? null : Number(row.bytes),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function deleteDocument(userId: string, documentId: string): Promise<void> {
  const doc = await ownedDocument(userId, documentId);
  await deleteObjects([doc.s3_key]);
  await query(`DELETE FROM documents WHERE id = $1 AND user_id = $2`, [documentId, userId]);
}

export async function listSessions(userId: string, projectId: string) {
  await ownedProject(userId, projectId);
  const result = await query(
    `SELECT id, title, created_at FROM chat_sessions WHERE user_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 60`,
    [userId, projectId],
  );
  return result.rows.map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at }));
}

export async function getSession(userId: string, sessionId: string) {
  const owned = await query<{ id: string; project_id: string }>(
    `SELECT id, project_id FROM chat_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  if (!owned.rowCount) {
    throw new HttpError(404, "Session not found");
  }
  const result = await query(
    `
    SELECT id, role, content, sources, model, prompt_tokens, completion_tokens, created_at
    FROM chat_history
    WHERE session_id = $1
    ORDER BY created_at
    `,
    [sessionId],
  );
  return { sessionId, projectId: owned.rows[0].project_id, messages: result.rows };
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  await query(`DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2`, [sessionId, userId]);
}
