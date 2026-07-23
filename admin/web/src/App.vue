<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  DocumentChecked,
  LocationInformation,
  Plus,
  Refresh,
  SwitchButton,
  View,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import api from "./api";

type Admin = { username: string; role: string };
type School = {
  _id: string;
  name: string;
  shortName: string;
  campus: string;
  province: string;
  sort: number;
  isOpen: boolean;
  logoUrl?: string;
};
type Post = {
  _id: string;
  title: string;
  content: string;
  nickName: string;
  status: string;
  imageUrls?: string[];
  createdAt?: string;
};

const token = ref(localStorage.getItem("uknow_admin_token") || "");
const admin = ref<Admin | null>(null);
const activeMenu = ref("posts");
const loading = ref(false);
const login = reactive({ username: "", password: "" });
const postStatus = ref("");
const posts = ref<Post[]>([]);
const schools = ref<School[]>([]);
const schoolKeyword = ref("");
const postPreview = ref<Post | null>(null);
const postPreviewOpen = ref(false);
const schoolDialogOpen = ref(false);
const editingSchool = ref<Partial<School>>({});
const schoolTitle = computed(() => (editingSchool.value._id ? "编辑学校" : "新增学校"));

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

async function restoreSession() {
  if (!token.value) return;
  try {
    const { data } = await api.get("/auth/me");
    admin.value = data.user;
    await refreshActivePage();
  } catch {
    logout();
  }
}

async function submitLogin() {
  loading.value = true;
  try {
    const { data } = await api.post("/auth/login", login);
    token.value = data.token;
    localStorage.setItem("uknow_admin_token", data.token);
    admin.value = data.user;
    login.password = "";
    await refreshActivePage();
  } catch {
    ElMessage.error("账号或密码错误");
  } finally {
    loading.value = false;
  }
}

function logout() {
  token.value = "";
  admin.value = null;
  localStorage.removeItem("uknow_admin_token");
}

async function refreshPosts() {
  loading.value = true;
  try {
    const params = postStatus.value ? { status: postStatus.value } : {};
    const { data } = await api.get("/posts", { params });
    posts.value = data.list || [];
  } catch {
    ElMessage.error("帖子列表加载失败");
  } finally {
    loading.value = false;
  }
}

async function refreshSchools() {
  loading.value = true;
  try {
    const { data } = await api.get("/schools", { params: { keyword: schoolKeyword.value } });
    schools.value = data.list || [];
  } catch {
    ElMessage.error("学校列表加载失败");
  } finally {
    loading.value = false;
  }
}

async function refreshActivePage() {
  if (activeMenu.value === "posts") return refreshPosts();
  return refreshSchools();
}

async function changePostStatus(post: Post, status: "published" | "hidden" | "rejected") {
  const labels = { published: "通过并发布", hidden: "下架", rejected: "驳回" };
  const { value = "" } = await ElMessageBox.prompt(
    `确认${labels[status]}「${post.title}」吗？可填写审核说明。`,
    labels[status],
    { inputPlaceholder: "审核说明（可选）", confirmButtonText: "确认", cancelButtonText: "取消" },
  );
  await api.patch(`/posts/${post._id}/status`, { status, reviewReason: value });
  ElMessage.success("操作已记录");
  postPreview.value = null;
  postPreviewOpen.value = false;
  await refreshPosts();
}

function showPost(post: unknown) {
  postPreview.value = post as Post;
  postPreviewOpen.value = true;
}

function openSchool(school?: unknown) {
  const selected = school as School | undefined;
  editingSchool.value = selected
    ? { ...selected }
    : { name: "", shortName: "", campus: "", province: "广东", sort: 0, isOpen: true, logoUrl: "" };
  schoolDialogOpen.value = true;
}

async function saveSchool() {
  const payload = editingSchool.value;
  if (!payload.name || !payload.shortName) {
    ElMessage.warning("请填写学校全称和简称");
    return;
  }
  if (payload._id) {
    await api.patch(`/schools/${payload._id}`, payload);
  } else {
    await api.post("/schools", payload);
  }
  schoolDialogOpen.value = false;
  ElMessage.success("学校信息已保存");
  await refreshSchools();
}

async function switchSchool(school: unknown) {
  const selected = school as School;
  await api.patch(`/schools/${selected._id}`, { isOpen: !selected.isOpen });
  ElMessage.success(selected.isOpen ? "已关闭该校区" : "已开放该校区");
  await refreshSchools();
}

onMounted(restoreSession);
</script>

<template>
  <main v-if="!admin" class="login-page">
    <section class="login-card" aria-labelledby="login-title">
      <p class="eyebrow">U-KNOW OPERATIONS</p>
      <h1 id="login-title">运营管理后台</h1>
      <p class="login-copy">使用管理员账号登录，所有操作都会留存审计记录。</p>
      <el-form label-position="top" @submit.prevent="submitLogin">
        <el-form-item label="管理员账号">
          <el-input v-model="login.username" autocomplete="username" placeholder="请输入账号" size="large" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="login.password" type="password" show-password autocomplete="current-password"
            placeholder="请输入密码" size="large" @keyup.enter="submitLogin" />
        </el-form-item>
        <el-button class="login-button" type="primary" size="large" :loading="loading" native-type="submit">
          登录后台
        </el-button>
      </el-form>
    </section>
  </main>

  <el-container v-else class="console-shell">
    <el-aside width="244px" class="sidebar">
      <div class="brand"><span class="brand-dot" /> U-Know</div>
      <p class="sidebar-label">内容与运营</p>
      <el-menu :default-active="activeMenu" class="nav-menu" @select="(key: string) => { activeMenu = key; refreshActivePage(); }">
        <el-menu-item index="posts"><el-icon><DocumentChecked /></el-icon><span>帖子审核</span></el-menu-item>
        <el-menu-item index="schools"><el-icon><LocationInformation /></el-icon><span>学校管理</span></el-menu-item>
      </el-menu>
      <div class="account-block">
        <strong>{{ admin.username }}</strong>
        <span>{{ admin.role }}</span>
        <el-button text :icon="SwitchButton" @click="logout">退出登录</el-button>
      </div>
    </el-aside>

    <el-container>
      <el-header class="page-header">
        <div>
          <p class="eyebrow">OPERATIONS CONSOLE</p>
          <h2>{{ activeMenu === "posts" ? "帖子审核" : "学校管理" }}</h2>
        </div>
        <el-button :icon="Refresh" :loading="loading" @click="refreshActivePage">刷新数据</el-button>
      </el-header>
      <el-main class="page-main">
        <template v-if="activeMenu === 'posts'">
          <section class="toolbar">
            <el-select v-model="postStatus" placeholder="全部状态" clearable @change="refreshPosts">
              <el-option label="待审核" value="pending" />
              <el-option label="已发布" value="published" />
              <el-option label="已下架" value="hidden" />
              <el-option label="已驳回" value="rejected" />
            </el-select>
          </section>
          <el-table :data="posts" v-loading="loading" class="data-table">
            <el-table-column label="内容" min-width="340">
              <template #default="{ row }"><strong>{{ row.title }}</strong><p class="content-preview">{{ row.content }}</p></template>
            </el-table-column>
            <el-table-column prop="nickName" label="作者" min-width="130" />
            <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="row.status === 'published' ? 'success' : row.status === 'pending' ? 'warning' : 'info'">{{ row.status }}</el-tag></template></el-table-column>
            <el-table-column label="发布时间" width="180"><template #default="{ row }">{{ formatDate(row.createdAt) }}</template></el-table-column>
            <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button text type="primary" :icon="View" @click="showPost(row)">查看</el-button></template></el-table-column>
          </el-table>
        </template>

        <template v-else>
          <section class="toolbar">
            <el-input v-model="schoolKeyword" placeholder="搜索学校或简称" clearable @keyup.enter="refreshSchools" />
            <el-button :icon="Refresh" @click="refreshSchools">搜索</el-button>
            <el-button type="primary" :icon="Plus" @click="openSchool()">新增学校</el-button>
          </section>
          <el-table :data="schools" v-loading="loading" class="data-table">
            <el-table-column prop="name" label="学校" min-width="200" />
            <el-table-column prop="shortName" label="简称" min-width="120" />
            <el-table-column prop="campus" label="校区" min-width="140" />
            <el-table-column prop="sort" label="排序" width="90" />
            <el-table-column label="开放" width="100"><template #default="{ row }"><el-switch :model-value="row.isOpen" @change="switchSchool(row)" /></template></el-table-column>
            <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button text type="primary" @click="openSchool(row)">编辑</el-button></template></el-table-column>
          </el-table>
        </template>
      </el-main>
    </el-container>
  </el-container>

  <el-dialog v-model="schoolDialogOpen" :title="schoolTitle" width="min(560px, 92vw)">
    <el-form label-position="top">
      <el-form-item label="学校全称"><el-input v-model="editingSchool.name" /></el-form-item>
      <el-form-item label="学校简称"><el-input v-model="editingSchool.shortName" /></el-form-item>
      <el-form-item label="校区"><el-input v-model="editingSchool.campus" /></el-form-item>
      <el-form-item label="省份"><el-input v-model="editingSchool.province" /></el-form-item>
      <el-form-item label="排序"><el-input-number v-model="editingSchool.sort" :min="0" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="schoolDialogOpen = false">取消</el-button><el-button type="primary" @click="saveSchool">保存</el-button></template>
  </el-dialog>

  <el-dialog v-model="postPreviewOpen" title="帖子详情" width="min(720px, 92vw)">
    <template v-if="postPreview">
      <p class="post-author">作者：{{ postPreview.nickName }}</p>
      <h3>{{ postPreview.title }}</h3>
      <p class="post-body">{{ postPreview.content }}</p>
      <div v-if="postPreview.imageUrls?.length" class="image-grid">
        <img v-for="image in postPreview.imageUrls" :key="image" :src="image" alt="帖子图片" loading="lazy" />
      </div>
    </template>
    <template #footer>
      <el-button type="danger" plain @click="changePostStatus(postPreview!, 'rejected')">驳回</el-button>
      <el-button type="warning" plain @click="changePostStatus(postPreview!, 'hidden')">下架</el-button>
      <el-button type="primary" @click="changePostStatus(postPreview!, 'published')">通过并发布</el-button>
    </template>
  </el-dialog>
</template>
