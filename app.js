import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// 1. USER & SANDI PRIBADI
const PERSONAL_USER = "mahasiswa";
const PERSONAL_PASS = "kuliah123";
const SESSION_KEY = "portal_kuliah_logged_in";
const LEGACY_LOCAL_KEY = "portal_kuliah_local_tasks_v1";

// 2. KONFIGURASI FIREBASE (opsional — isi jika ingin sinkron HP & laptop)
const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

const hasFirebase = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
let db = null;
let storage = null;

if (hasFirebase) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  if (firebaseConfig.storageBucket) {
    storage = getStorage(app);
  }
}

let allTasks = [];
let unsubscribeFirestore = null;
const activeObjectUrls = [];

// Elemen Auth
const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const authForm = document.getElementById("auth-form");
const authUser = document.getElementById("auth-user");
const authPassword = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const btnLogout = document.getElementById("btn-logout");
const storageModeLabel = document.getElementById("storage-mode-label");

// Elemen Dashboard & Filter
const statTotal = document.getElementById("stat-total");
const statTodo = document.getElementById("stat-todo");
const statProgress = document.getElementById("stat-progress");
const statDone = document.getElementById("stat-done");
const searchInput = document.getElementById("search-input");
const filterStatus = document.getElementById("filter-status");
const filterCourse = document.getElementById("filter-course");
const tasksList = document.getElementById("tasks-list");

// Elemen Modal Tugas
const btnOpenCreate = document.getElementById("btn-open-create");
const taskModal = document.getElementById("task-modal");
const modalTitle = document.getElementById("modal-title");
const btnCloseModal = document.getElementById("btn-close-modal");
const btnCancelModal = document.getElementById("btn-cancel-modal");
const taskForm = document.getElementById("task-form");
const taskIdInput = document.getElementById("task-id");
const existingPdfUrl = document.getElementById("existing-pdf-url");
const existingPdfPath = document.getElementById("existing-pdf-path");
const existingPdfName = document.getElementById("existing-pdf-name");
const taskName = document.getElementById("task-name");
const taskCourse = document.getElementById("task-course");
const taskLecturer = document.getElementById("task-lecturer");
const taskDeadline = document.getElementById("task-deadline");
const taskStatus = document.getElementById("task-status");
const taskSubmitLink = document.getElementById("task-submit-link");
const taskDesc = document.getElementById("task-desc");
const taskPdf = document.getElementById("task-pdf");
const currentPdfInfo = document.getElementById("current-pdf-info");
const formError = document.getElementById("form-error");
const btnSaveTask = document.getElementById("btn-save-task");

// Elemen Modal PDF
const pdfModal = document.getElementById("pdf-modal");
const pdfModalTitle = document.getElementById("pdf-modal-title");
const pdfDownloadLink = document.getElementById("pdf-download-link");
const pdfFrame = document.getElementById("pdf-frame");
const btnClosePdfModal = document.getElementById("btn-close-pdf-modal");

// Helper IndexedDB untuk penyimpanan lokal
function openLocalDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("PortalKuliahDB", 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains("tasks")) {
        database.createObjectStore("tasks", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAllTasks() {
  const database = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("tasks", "readonly");
    const store = tx.objectStore("tasks");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutTask(task) {
  const database = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("tasks", "readwrite");
    const store = tx.objectStore("tasks");
    const req = store.put(task);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDeleteTask(id) {
  const database = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("tasks", "readwrite");
    const store = tx.objectStore("tasks");
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Bersihkan localStorage lama jika sempat penuh
try {
  localStorage.removeItem(LEGACY_LOCAL_KEY);
} catch {
  // abaikan
}

function revokeObjectUrls() {
  while (activeObjectUrls.length) {
    const url = activeObjectUrls.pop();
    URL.revokeObjectURL(url);
  }
}

// Login & Logout
authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  authError.textContent = "";

  const inputUser = authUser.value.trim();
  const inputPass = authPassword.value;

  if (inputUser === PERSONAL_USER && inputPass === PERSONAL_PASS) {
    localStorage.setItem(SESSION_KEY, "1");
    authForm.reset();
    showApp();
  } else {
    authError.textContent = "User atau sandi salah.";
  }
});

btnLogout.addEventListener("click", () => {
  localStorage.removeItem(SESSION_KEY);
  revokeObjectUrls();
  if (unsubscribeFirestore) {
    unsubscribeFirestore();
    unsubscribeFirestore = null;
  }
  showLogin();
});

function showLogin() {
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
}

async function showApp() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");

  if (hasFirebase) {
    storageModeLabel.textContent = "Penyimpanan: Firebase (sinkron HP & laptop)";
    startFirebaseListener();
  } else {
    storageModeLabel.textContent = "Penyimpanan: IndexedDB browser (kapasitas besar, khusus perangkat ini)";
    await refreshLocalTasks();
  }
}

async function refreshLocalTasks() {
  revokeObjectUrls();
  const rows = await idbGetAllTasks();
  rows.sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));

  allTasks = rows.map((row) => {
    let pdfUrl = "";
    if (row.pdfBlob instanceof Blob) {
      pdfUrl = URL.createObjectURL(row.pdfBlob);
      activeObjectUrls.push(pdfUrl);
    }
    return { ...row, pdfUrl };
  });

  renderAll();
}

// Sinkronisasi Firebase Firestore
function startFirebaseListener() {
  if (unsubscribeFirestore) unsubscribeFirestore();
  const q = query(collection(db, "personal_tasks"), orderBy("deadline", "asc"));
  unsubscribeFirestore = onSnapshot(
    q,
    (snapshot) => {
      allTasks = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
    },
    (err) => {
      console.error(err);
      tasksList.innerHTML = `<div class="empty-state">Gagal terhubung ke Firebase. Periksa konfigurasi dan rules Firestore.</div>`;
    }
  );
}

function renderAll() {
  updateStats(allTasks);
  populateCourseFilter(allTasks);
  renderTasks(getFilteredTasks(allTasks));
}

function updateStats(tasks) {
  statTotal.textContent = tasks.length;
  statTodo.textContent = tasks.filter((t) => t.status === "Belum dikerjakan").length;
  statProgress.textContent = tasks.filter((t) => t.status === "Sedang dikerjakan").length;
  statDone.textContent = tasks.filter((t) => t.status === "Selesai").length;
}

function populateCourseFilter(tasks) {
  const previous = filterCourse.value;
  const courses = [...new Set(tasks.map((t) => t.course).filter(Boolean))].sort();

  filterCourse.innerHTML = `<option value="ALL">Semua Mata Kuliah</option>`;
  courses.forEach((course) => {
    const opt = document.createElement("option");
    opt.value = course;
    opt.textContent = course;
    filterCourse.appendChild(opt);
  });

  if (courses.includes(previous)) {
    filterCourse.value = previous;
  }
}

function getFilteredTasks(tasks) {
  const keyword = searchInput.value.trim().toLowerCase();
  const statusVal = filterStatus.value;
  const courseVal = filterCourse.value;

  return tasks.filter((task) => {
    const matchStatus = statusVal === "ALL" || task.status === statusVal;
    const matchCourse = courseVal === "ALL" || task.course === courseVal;
    const matchKeyword =
      !keyword ||
      (task.name || "").toLowerCase().includes(keyword) ||
      (task.course || "").toLowerCase().includes(keyword) ||
      (task.lecturer || "").toLowerCase().includes(keyword) ||
      (task.description || "").toLowerCase().includes(keyword);

    return matchStatus && matchCourse && matchKeyword;
  });
}

function getStatusBadgeClass(status) {
  if (status === "Selesai") return "done";
  if (status === "Sedang dikerjakan") return "progress";
  return "todo";
}

function formatDeadline(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderTasks(tasks) {
  if (!tasks.length) {
    tasksList.innerHTML = `<div class="empty-state">Belum ada tugas atau tidak ada yang cocok dengan pencarian/filter.</div>`;
    return;
  }

  tasksList.innerHTML = tasks
    .map((task) => {
      const badgeClass = getStatusBadgeClass(task.status);
      const pdfButtons = task.pdfUrl
        ? `
          <button type="button" class="link-chip btn-preview-pdf"
            data-url="${escapeHtml(task.pdfUrl)}"
            data-name="${escapeHtml(task.pdfName || task.name + ".pdf")}">
            Lihat PDF
          </button>
          <a href="${escapeHtml(task.pdfUrl)}" download="${escapeHtml(task.pdfName || "tugas.pdf")}" target="_blank" rel="noopener" class="link-chip">
            Unduh PDF
          </a>
        `
        : "";

      const submitLinkBtn = task.submitLink
        ? `<a href="${escapeHtml(task.submitLink)}" target="_blank" rel="noopener noreferrer" class="link-chip">Link Pengumpulan</a>`
        : "";

      return `
        <article class="task-card" data-id="${escapeHtml(task.id)}">
          <div>
            <div class="task-top">
              <h3 class="task-title">${escapeHtml(task.name)}</h3>
              <span class="badge ${badgeClass}">${escapeHtml(task.status)}</span>
            </div>

            <div class="task-meta" style="margin-top: 0.5rem;">
              <span><strong>Mata Kuliah:</strong> ${escapeHtml(task.course)}</span>
              <span><strong>Dosen:</strong> ${escapeHtml(task.lecturer)}</span>
              <span><strong>Deadline:</strong> ${escapeHtml(formatDeadline(task.deadline))}</span>
            </div>

            ${task.description ? `<p class="task-desc" style="margin-top: 0.65rem;">${escapeHtml(task.description)}</p>` : ""}

            <div class="task-links" style="margin-top: 0.75rem;">
              ${pdfButtons}
              ${submitLinkBtn}
            </div>
          </div>

          <div class="task-footer">
            <select class="status-quick-select" data-action="quick-status" aria-label="Ubah status tugas">
              <option value="Belum dikerjakan" ${task.status === "Belum dikerjakan" ? "selected" : ""}>Belum dikerjakan</option>
              <option value="Sedang dikerjakan" ${task.status === "Sedang dikerjakan" ? "selected" : ""}>Sedang dikerjakan</option>
              <option value="Selesai" ${task.status === "Selesai" ? "selected" : ""}>Selesai</option>
            </select>

            <div class="card-actions">
              <button type="button" class="btn btn-outline btn-sm" data-action="edit">Edit</button>
              <button type="button" class="btn btn-danger btn-sm" data-action="delete">Hapus</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

searchInput.addEventListener("input", () => renderTasks(getFilteredTasks(allTasks)));
filterStatus.addEventListener("change", () => renderTasks(getFilteredTasks(allTasks)));
filterCourse.addEventListener("change", () => renderTasks(getFilteredTasks(allTasks)));

// Modal Tambah / Edit
btnOpenCreate.addEventListener("click", () => {
  taskForm.reset();
  taskIdInput.value = "";
  existingPdfUrl.value = "";
  existingPdfPath.value = "";
  existingPdfName.value = "";
  currentPdfInfo.textContent = hasFirebase
    ? "File PDF disimpan di Firebase Storage (maks. 25 MB)."
    : "File PDF disimpan di IndexedDB browser (maks. 25 MB).";
  formError.textContent = "";
  modalTitle.textContent = "Tambah Tugas Baru";
  taskModal.classList.remove("hidden");
});

function closeTaskModal() {
  taskModal.classList.add("hidden");
}

btnCloseModal.addEventListener("click", closeTaskModal);
btnCancelModal.addEventListener("click", closeTaskModal);

// Aksi pada Kartu Tugas
tasksList.addEventListener("click", async (e) => {
  const previewBtn = e.target.closest(".btn-preview-pdf");
  if (previewBtn) {
    openPdfPreview(previewBtn.dataset.url, previewBtn.dataset.name);
    return;
  }

  const card = e.target.closest(".task-card");
  if (!card) return;
  const task = allTasks.find((t) => t.id === card.dataset.id);
  if (!task) return;

  const actionEl = e.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === "edit") {
    taskIdInput.value = task.id;
    taskName.value = task.name || "";
    taskCourse.value = task.course || "";
    taskLecturer.value = task.lecturer || "";
    taskDeadline.value = task.deadline || "";
    taskStatus.value = task.status || "Belum dikerjakan";
    taskSubmitLink.value = task.submitLink || "";
    taskDesc.value = task.description || "";
    existingPdfUrl.value = task.pdfUrl || "";
    existingPdfPath.value = task.pdfPath || "";
    existingPdfName.value = task.pdfName || "";
    taskPdf.value = "";
    currentPdfInfo.textContent = task.pdfName
      ? `PDF saat ini: ${task.pdfName} (pilih file baru untuk mengganti)`
      : "Belum ada file PDF.";
    formError.textContent = "";
    modalTitle.textContent = "Edit Tugas";
    taskModal.classList.remove("hidden");
  }

  if (action === "delete") {
    if (!confirm(`Hapus tugas "${task.name}"?`)) return;

    if (hasFirebase) {
      if (task.pdfPath && storage) {
        await deleteObject(ref(storage, task.pdfPath)).catch(() => {});
      }
      await deleteDoc(doc(db, "personal_tasks", task.id));
    } else {
      await idbDeleteTask(task.id);
      await refreshLocalTasks();
    }
  }
});

tasksList.addEventListener("change", async (e) => {
  const select = e.target.closest('[data-action="quick-status"]');
  if (!select) return;
  const card = select.closest(".task-card");
  if (!card) return;

  if (hasFirebase) {
    await updateDoc(doc(db, "personal_tasks", card.dataset.id), {
      status: select.value,
      updatedAt: serverTimestamp()
    });
  } else {
    const existing = allTasks.find((t) => t.id === card.dataset.id);
    if (existing) {
      const { pdfUrl, ...rest } = existing;
      await idbPutTask({ ...rest, status: select.value });
      await refreshLocalTasks();
    }
  }
});

// Simpan Tugas + Upload PDF
taskForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";

  const file = taskPdf.files[0];
  const maxBytes = 25 * 1024 * 1024;

  if (file) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      formError.textContent = "Hanya file PDF yang diperbolehkan.";
      return;
    }
    if (file.size > maxBytes) {
      formError.textContent = "Ukuran file PDF maksimal 25 MB.";
      return;
    }
  }

  btnSaveTask.disabled = true;
  btnSaveTask.textContent = "Menyimpan...";

  try {
    let pdfUrl = existingPdfUrl.value;
    let pdfPath = existingPdfPath.value;
    let pdfName = existingPdfName.value;
    let pdfBlob = null;

    const editingId = taskIdInput.value;
    const prevTask = editingId ? allTasks.find((t) => t.id === editingId) : null;
    if (prevTask && prevTask.pdfBlob instanceof Blob) {
      pdfBlob = prevTask.pdfBlob;
    }

    if (file) {
      if (hasFirebase && storage) {
        if (pdfPath) {
          await deleteObject(ref(storage, pdfPath)).catch(() => {});
        }
        const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        pdfPath = `personal_pdf/${safeName}`;
        const storageRef = ref(storage, pdfPath);
        await uploadBytes(storageRef, file);
        pdfUrl = await getDownloadURL(storageRef);
      } else {
        pdfBlob = file;
        pdfPath = "";
      }
      pdfName = file.name;
    }

    const payload = {
      name: taskName.value.trim(),
      course: taskCourse.value.trim(),
      lecturer: taskLecturer.value.trim(),
      deadline: taskDeadline.value,
      status: taskStatus.value,
      submitLink: taskSubmitLink.value.trim(),
      description: taskDesc.value.trim(),
      pdfUrl,
      pdfPath,
      pdfName
    };

    if (hasFirebase) {
      if (editingId) {
        await updateDoc(doc(db, "personal_tasks", editingId), {
          ...payload,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, "personal_tasks"), {
          ...payload,
          createdAt: serverTimestamp()
        });
      }
    } else {
      await idbPutTask({
        id: editingId || `local_${Date.now()}`,
        ...payload,
        pdfBlob
      });
      await refreshLocalTasks();
    }

    closeTaskModal();
  } catch (err) {
    formError.textContent = "Gagal menyimpan: " + err.message;
  } finally {
    btnSaveTask.disabled = false;
    btnSaveTask.textContent = "Simpan Tugas";
  }
});

// Pratinjau & Unduh PDF
function openPdfPreview(url, name) {
  pdfModalTitle.textContent = name || "Pratinjau PDF";
  pdfFrame.src = url;
  pdfDownloadLink.href = url;
  pdfDownloadLink.setAttribute("download", name || "tugas.pdf");
  pdfModal.classList.remove("hidden");
}

btnClosePdfModal.addEventListener("click", () => {
  pdfModal.classList.add("hidden");
  pdfFrame.src = "";
});

// Cek Sesi Saat Halaman Dimuat
if (localStorage.getItem(SESSION_KEY) === "1") {
  showApp();
} else {
  showLogin();
}