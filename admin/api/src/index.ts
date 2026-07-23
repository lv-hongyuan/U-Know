import "dotenv/config";
import bcrypt from "bcryptjs";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify, { type FastifyRequest } from "fastify";
import cloudbase from "@cloudbase/node-sdk";
import { z } from "zod";

const env = z
  .object({
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().positive().default(3000),
    JWT_SECRET: z.string().min(32),
    CLOUDBASE_ENV_ID: z.string().min(1),
    CLOUDBASE_APIKEY: z.string().min(1).optional(),
    TENCENTCLOUD_SECRETID: z.string().min(1).optional(),
    TENCENTCLOUD_SECRETKEY: z.string().min(1).optional(),
    BOOTSTRAP_ADMIN_USERNAME: z.string().min(3).optional(),
    BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.CLOUDBASE_APIKEY) return;
    if (value.TENCENTCLOUD_SECRETID && value.TENCENTCLOUD_SECRETKEY) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Set CLOUDBASE_APIKEY or both Tencent Cloud API credentials.",
      path: ["CLOUDBASE_APIKEY"],
    });
  })
  .parse(process.env);

const app = Fastify({ logger: true });
const cloudApp = cloudbase.init({
  env: env.CLOUDBASE_ENV_ID,
  ...(env.CLOUDBASE_APIKEY
    ? { accessKey: env.CLOUDBASE_APIKEY }
    : {
        secretId: env.TENCENTCLOUD_SECRETID!,
        secretKey: env.TENCENTCLOUD_SECRETKEY!,
      }),
});
const db: any = cloudApp.database();

type AdminRole = "super_admin" | "content_moderator" | "school_operator";
type AuthUser = { id: string; username: string; role: AdminRole };

function getAuthUser(request: FastifyRequest): AuthUser {
  return request.user as AuthUser;
}

async function ensureCollection(name: string) {
  try {
    await db.createCollection(name);
  } catch {
    // The collection already exists, or the current CAM policy disallows creation.
  }
}

async function writeAudit(
  admin: AuthUser,
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown> = {},
) {
  await ensureCollection("admin_audit_logs");
  await db.collection("admin_audit_logs").add({
    adminId: admin.id,
    adminUsername: admin.username,
    action,
    targetType,
    targetId,
    detail,
    createdAt: new Date(),
  });
}

function requireRoles(...roles: AdminRole[]) {
  return async (request: FastifyRequest, reply: any) => {
    try {
      await request.jwtVerify();
      if (!roles.includes(getAuthUser(request).role)) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
  };
}

async function bootstrapAdmin() {
  await ensureCollection("admin_users");
  const admins = db.collection("admin_users");
  const { total } = await admins.count();
  if (total > 0) return;

  if (!env.BOOTSTRAP_ADMIN_USERNAME || !env.BOOTSTRAP_ADMIN_PASSWORD) {
    app.log.warn("No administrator exists. Set bootstrap admin variables for the first startup.");
    return;
  }

  const passwordHash = await bcrypt.hash(env.BOOTSTRAP_ADMIN_PASSWORD, 12);
  await admins.add({
    username: env.BOOTSTRAP_ADMIN_USERNAME,
    passwordHash,
    role: "super_admin",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  app.log.warn("Initial administrator created. Remove BOOTSTRAP_ADMIN_PASSWORD from the environment.");
}

async function resolvePostImages(post: Record<string, any>) {
  const images = Array.isArray(post.images) ? post.images.filter(Boolean) : [];
  const cloudIds = images.filter((item: string) => item.startsWith("cloud://"));
  if (!cloudIds.length) return { ...post, imageUrls: images };

  try {
    const result: any = await cloudApp.getTempFileURL({ fileList: cloudIds });
    const urlMap = Object.fromEntries(
      (result.fileList || []).map((item: any) => [item.fileID, item.tempFileURL]),
    );
    return { ...post, imageUrls: images.map((item: string) => urlMap[item] || item) };
  } catch (error) {
    app.log.warn({ error }, "Failed to resolve CloudBase image URLs");
    return { ...post, imageUrls: images };
  }
}

await app.register(cors, {
  origin: process.env.ADMIN_WEB_ORIGIN ? process.env.ADMIN_WEB_ORIGIN.split(",") : false,
});
await app.register(jwt, { secret: env.JWT_SECRET });

app.get("/health", async () => ({ ok: true }));

app.post("/auth/login", async (request, reply) => {
  const body = z
    .object({ username: z.string().trim().min(1), password: z.string().min(1) })
    .parse(request.body);
  const { data } = await db.collection("admin_users").where({ username: body.username }).limit(1).get();
  const admin = data?.[0];
  if (!admin || admin.status !== "active" || !(await bcrypt.compare(body.password, admin.passwordHash))) {
    return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
  }

  const user: AuthUser = { id: admin._id, username: admin.username, role: admin.role };
  const token = await reply.jwtSign(user, { expiresIn: "8h" });
  await db.collection("admin_users").doc(admin._id).update({ lastLoginAt: new Date() });
  await writeAudit(user, "auth.login", "admin_user", admin._id);
  return { token, user };
});

app.get("/auth/me", { preHandler: requireRoles("super_admin", "content_moderator", "school_operator") }, async (request) => ({
  user: getAuthUser(request),
}));

app.get("/schools", { preHandler: requireRoles("super_admin", "school_operator") }, async (request) => {
  const query = z.object({ keyword: z.string().trim().optional() }).parse(request.query);
  const { data } = await db.collection("schools").orderBy("sort", "asc").limit(1000).get();
  const keyword = query.keyword?.toLowerCase();
  const list = (data || []).filter((school: any) => {
    if (!keyword) return true;
    return [school.name, school.shortName, school.campus].some((value) =>
      String(value || "").toLowerCase().includes(keyword),
    );
  });
  return { list, total: list.length };
});

app.post("/schools", { preHandler: requireRoles("super_admin", "school_operator") }, async (request, reply) => {
  const body = z.object({
    name: z.string().trim().min(1),
    shortName: z.string().trim().min(1),
    campus: z.string().trim().default(""),
    province: z.string().trim().default("广东"),
    logoUrl: z.string().trim().default(""),
    sort: z.number().int().default(0),
    isOpen: z.boolean().default(true),
  }).parse(request.body);
  const schools = db.collection("schools");
  const { data: existing } = await schools.where({ name: body.name, campus: body.campus }).limit(1).get();
  if (existing?.length) return reply.code(409).send({ error: "DUPLICATE_SCHOOL" });
  const now = new Date();
  const result = await schools.add({ ...body, createdAt: now, updatedAt: now });
  await writeAudit(getAuthUser(request), "school.create", "school", result._id, body);
  return reply.code(201).send({ id: result._id });
});

app.patch("/schools/:id", { preHandler: requireRoles("super_admin", "school_operator") }, async (request) => {
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = z.object({
    name: z.string().trim().min(1).optional(),
    shortName: z.string().trim().min(1).optional(),
    campus: z.string().trim().optional(),
    province: z.string().trim().optional(),
    logoUrl: z.string().trim().optional(),
    sort: z.number().int().optional(),
    isOpen: z.boolean().optional(),
  }).parse(request.body);
  await db.collection("schools").doc(params.id).update({ ...body, updatedAt: new Date() });
  await writeAudit(getAuthUser(request), "school.update", "school", params.id, body);
  return { ok: true };
});

app.get("/posts", { preHandler: requireRoles("super_admin", "content_moderator") }, async (request) => {
  const query = z.object({
    status: z.enum(["pending", "published", "hidden", "rejected"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  }).parse(request.query);
  const collection = db.collection("posts");
  const filter = query.status ? { status: query.status } : {};
  const { data } = await collection.where(filter).orderBy("createdAt", "desc")
    .skip((query.page - 1) * query.pageSize).limit(query.pageSize).get();
  const { total } = await collection.where(filter).count();
  return { list: await Promise.all((data || []).map(resolvePostImages)), total, page: query.page, pageSize: query.pageSize };
});

app.get("/posts/:id", { preHandler: requireRoles("super_admin", "content_moderator") }, async (request, reply) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  try {
    const { data } = await db.collection("posts").doc(id).get();
    return { post: await resolvePostImages(data) };
  } catch {
    return reply.code(404).send({ error: "POST_NOT_FOUND" });
  }
});

app.patch("/posts/:id/status", { preHandler: requireRoles("super_admin", "content_moderator") }, async (request) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = z.object({
    status: z.enum(["published", "hidden", "rejected"]),
    reviewReason: z.string().trim().max(300).default(""),
  }).parse(request.body);
  const admin = getAuthUser(request);
  await db.collection("posts").doc(id).update({
    ...body,
    reviewedBy: admin.id,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  });
  await writeAudit(admin, `post.${body.status}`, "post", id, { reviewReason: body.reviewReason });
  return { ok: true };
});

await bootstrapAdmin();
await app.listen({ host: env.HOST, port: env.PORT });
