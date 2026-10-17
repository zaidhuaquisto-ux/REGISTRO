"use strict";

const STORAGE_KEY = "fbcMelgarActivitiesV1";
const IMAGE_DB_NAME = "fbcMelgarEvidenceV1";
const IMAGE_STORE_NAME = "evidence";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const form = document.querySelector("#activityForm");
const formMessage = document.querySelector("#formMessage");
const codeInput = document.querySelector("#code");
const dateInput = document.querySelector("#date");
const startTimeInput = document.querySelector("#startTime");
const endTimeInput = document.querySelector("#endTime");
const photoInput = document.querySelector("#photo");
const photoPreview = document.querySelector("#photoPreview");
const previewImage = document.querySelector("#previewImage");
const photoName = document.querySelector("#photoName");
const saveButton = document.querySelector("#saveButton");
const demoBanner = document.querySelector("#demoBanner");
const editHint = document.querySelector("#editHint");
const recordList = document.querySelector("#recordList");
const recordsEmpty = document.querySelector("#recordsEmpty");
const followupList = document.querySelector("#followupList");
const followupEmpty = document.querySelector("#followupEmpty");
const detailsDialog = document.querySelector("#detailsDialog");
const detailBody = document.querySelector("#detailBody");

let activities = readActivities();
let editingCode = null;
let selectedImage = null;
let imageRemoved = false;
let demoMode = false;
let currentDetailsCode = null;
let previewUrl = null;
let dialogImageUrl = null;
let imageDatabasePromise = null;

// IndexedDB guarda las fotografías como archivos Blob fuera de localStorage.
function openImageDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("Este navegador no permite guardar fotografías localmente."));
  }
  if (imageDatabasePromise) return imageDatabasePromise;

  imageDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        database.createObjectStore(IMAGE_STORE_NAME, { keyPath: "code" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No se pudo abrir el almacenamiento de fotografías."));
  });
  return imageDatabasePromise;
}

async function saveImage(code, file) {
  const database = await openImageDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).put({ code, blob: file, name: file.name, type: file.type });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("No se pudo guardar la fotografía."));
    transaction.onabort = () => reject(transaction.error || new Error("No se pudo guardar la fotografía."));
  });
}

async function getImage(code) {
  const database = await openImageDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(IMAGE_STORE_NAME, "readonly").objectStore(IMAGE_STORE_NAME).get(code);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("No se pudo recuperar la fotografía."));
  });
}

async function deleteImage(code) {
  try {
    const database = await openImageDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
      transaction.objectStore(IMAGE_STORE_NAME).delete(code);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("No se pudo eliminar una fotografía local:", error);
  }
}

function readActivities() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.warn("No se pudieron leer los registros locales:", error);
    return [];
  }
}

function persistActivities() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activities));
    return true;
  } catch (error) {
    showMessage("No se pudieron guardar los datos en este navegador. Revisa el espacio disponible.", "error");
    console.error(error);
    return false;
  }
}

function nextCode() {
  const usedCodes = new Set(activities.map((item) => item.code));
  let number = activities.reduce((largest, item) => {
    const match = /^REG-(\d+)$/.exec(item.code || "");
    return match ? Math.max(largest, Number(match[1])) : largest;
  }, 0) + 1;
  let candidate = `REG-${String(number).padStart(3, "0")}`;
  while (usedCodes.has(candidate)) {
    number += 1;
    candidate = `REG-${String(number).padStart(3, "0")}`;
  }
  return candidate;
}

function showMessage(message, type = "success") {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type}`;
  formMessage.hidden = false;
}

function hideMessage() {
  formMessage.hidden = true;
  formMessage.textContent = "";
  formMessage.className = "form-message";
}

function updatePreview(blob, name) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (!blob) {
    previewUrl = null;
    photoPreview.hidden = true;
    previewImage.removeAttribute("src");
    photoName.textContent = "";
    return;
  }
  previewUrl = URL.createObjectURL(blob);
  previewImage.src = previewUrl;
  photoName.textContent = name || "Evidencia fotográfica";
  photoPreview.hidden = false;
}

function updateCode() {
  codeInput.value = editingCode || nextCode();
}

function setDemoMode(isDemo) {
  demoMode = isDemo;
  demoBanner.hidden = !isDemo;
}

function clearForm(askFirst = true) {
  if (askFirst && !window.confirm("¿Quieres limpiar el formulario? Se perderán los datos que aún no hayas guardado.")) return;
  form.reset();
  editingCode = null;
  selectedImage = null;
  imageRemoved = false;
  setDemoMode(false);
  startTimeInput.setCustomValidity("");
  endTimeInput.setCustomValidity("");
  saveButton.innerHTML = '<span aria-hidden="true">＋</span> Registrar actividad';
  editHint.hidden = true;
  updatePreview(null);
  updateCode();
  hideMessage();
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-PE", { dateStyle: "medium" }).format(date);
}

function statusClass(status) {
  return `status-${String(status || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`;
}

function makeStatusBadge(status) {
  const badge = document.createElement("span");
  badge.className = `status-badge ${statusClass(status)}`;
  badge.textContent = status || "Sin estado";
  return badge;
}

function makeRecordAction(label, action, code, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `action-button${danger ? " danger" : ""}`;
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.code = code;
  button.setAttribute("aria-label", `${label} ${code}`);
  return button;
}

function addRecordValue(container, label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "record-value";
  const caption = document.createElement("small");
  caption.textContent = label;
  wrapper.append(caption, document.createTextNode(value || "No asignado"));
  container.append(wrapper);
}

function renderRecords() {
  const search = document.querySelector("#searchInput").value.trim().toLocaleLowerCase("es");
  const state = document.querySelector("#statusFilter").value;
  const sorted = [...activities].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.code.localeCompare(a.code));
  const visible = sorted.filter((item) => {
    const matchesSearch = !search || `${item.code} ${item.activityName}`.toLocaleLowerCase("es").includes(search);
    return matchesSearch && (!state || item.status === state);
  });

  recordList.replaceChildren();
  recordsEmpty.hidden = visible.length > 0;
  if (activities.length && visible.length === 0) {
    recordsEmpty.textContent = "No hay actividades que coincidan con la búsqueda o el filtro.";
  } else {
    recordsEmpty.textContent = "Todavía no hay registros. Puedes cargar el ejemplo ficticio o completar el formulario.";
  }

  visible.forEach((item) => {
    const card = document.createElement("article");
    card.className = "record-card";
    const main = document.createElement("div");
    main.className = "record-main";
    const code = document.createElement("span");
    code.className = "record-code";
    code.textContent = item.code;
    const name = document.createElement("span");
    name.className = "record-name";
    name.textContent = item.activityName;
    if (item.isDemo) {
      const demoTag = document.createElement("span");
      demoTag.className = "record-demo-tag";
      demoTag.textContent = "Ficticio";
      name.append(demoTag);
    }
    main.append(code, name);
    card.append(main);
    addRecordValue(card, "Fecha", formatDate(item.date));
    addRecordValue(card, "Área responsable", item.area);
    const stateValue = document.createElement("div");
    stateValue.className = "record-value";
    const stateLabel = document.createElement("small");
    stateLabel.textContent = "Estado";
    stateValue.append(stateLabel, makeStatusBadge(item.status));
    card.append(stateValue);
    const ownerValue = document.createElement("div");
    ownerValue.className = "record-value";
    const ownerLabel = document.createElement("small");
    ownerLabel.textContent = "Seguimiento";
    ownerValue.append(ownerLabel, document.createTextNode(item.followupOwner || "No asignado"));
    card.append(ownerValue);
    const actions = document.createElement("div");
    actions.className = "record-actions";
    actions.append(
      makeRecordAction("Ver", "view", item.code),
      makeRecordAction("Editar", "edit", item.code),
      makeRecordAction("PDF", "pdf", item.code),
      makeRecordAction("Eliminar", "delete", item.code, true)
    );
    card.append(actions);
    recordList.append(card);
  });
  renderSummary();
  renderFollowups();
}

function needsFollowup(item) {
  return item.status !== "Finalizada" && (
    item.status === "Pendiente de seguimiento" || Boolean(item.followupDate) || Boolean((item.tasks || "").trim())
  );
}

function isOverdue(item) {
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return Boolean(item.followupDate && item.followupDate < todayString && item.status !== "Finalizada");
}

function renderFollowups() {
  const pending = activities.filter(needsFollowup).sort((a, b) => (a.followupDate || "9999").localeCompare(b.followupDate || "9999"));
  followupList.replaceChildren();
  followupEmpty.hidden = pending.length > 0;
  document.querySelector("#followupChip").textContent = String(pending.length);
  document.querySelector("#followupCount").textContent = String(pending.length);

  pending.slice(0, 8).forEach((item) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `followup-item${isOverdue(item) ? " is-late" : ""}`;
    row.dataset.action = "view";
    row.dataset.code = item.code;
    const title = document.createElement("span");
    title.className = "followup-title";
    title.textContent = item.activityName;
    const meta = document.createElement("span");
    meta.className = "followup-meta";
    meta.textContent = `${item.followupOwner || "Sin responsable"} · ${formatDate(item.followupDate)}`;
    row.append(title, meta, makeStatusBadge(item.status));
    if (isOverdue(item)) {
      const late = document.createElement("span");
      late.className = "late-note";
      late.textContent = "Seguimiento atrasado";
      row.append(late);
    }
    followupList.append(row);
  });
}

function renderSummary() {
  document.querySelector("#totalCount").textContent = String(activities.length);
  document.querySelector("#completedCount").textContent = String(activities.filter((item) => item.status === "Finalizada").length);
}

function collectFormData(code) {
  const values = new FormData(form);
  return {
    code,
    date: values.get("date"),
    startTime: values.get("startTime"),
    endTime: values.get("endTime"),
    area: values.get("area"),
    activityName: values.get("activityName").trim(),
    description: values.get("description").trim(),
    activityLead: values.get("activityLead").trim(),
    status: values.get("status"),
    agreements: values.get("agreements").trim(),
    observations: values.get("observations").trim(),
    tasks: values.get("tasks").trim(),
    followupOwner: values.get("followupOwner").trim(),
    followupDate: values.get("followupDate"),
    isDemo: demoMode,
    updatedAt: new Date().toISOString()
  };
}

function validateForm() {
  startTimeInput.setCustomValidity("");
  endTimeInput.setCustomValidity("");
  [dateInput, document.querySelector("#area"), document.querySelector("#activityName")].forEach((field) => field.setCustomValidity(""));
  if (startTimeInput.value && endTimeInput.value && endTimeInput.value < startTimeInput.value) {
    endTimeInput.setCustomValidity("La hora de finalización no puede ser anterior a la hora de inicio.");
    endTimeInput.reportValidity();
    return false;
  }
  if (!form.checkValidity()) {
    const invalidField = form.querySelector(":invalid");
    const messages = {
      date: "Selecciona la fecha de la actividad.",
      area: "Selecciona el área responsable.",
      activityName: "Escribe el nombre de la actividad."
    };
    invalidField.setCustomValidity(messages[invalidField.id] || "Completa este campo antes de continuar.");
    invalidField.reportValidity();
    return false;
  }
  return true;
}

function validImage(file) {
  const allowedTypes = ["image/jpeg", "image/png"];
  const extensionIsValid = /\.(jpe?g|png)$/i.test(file.name);
  if (!allowedTypes.includes(file.type) && !extensionIsValid) {
    showMessage("Selecciona una imagen JPG o PNG.", "error");
    return false;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    showMessage("La imagen supera los 5 MB. Elige una versión más pequeña para incluirla en el reporte.", "error");
    return false;
  }
  return true;
}

async function handleSubmit(event) {
  event.preventDefault();
  hideMessage();
  if (!validateForm()) return;
  if (selectedImage && !validImage(selectedImage)) return;

  const code = editingCode || nextCode();
  const oldRecord = activities.find((item) => item.code === code);
  const record = { ...oldRecord, ...collectFormData(code), photoKey: oldRecord?.photoKey || null };
  try {
    if (selectedImage) {
      await saveImage(code, selectedImage);
      record.photoKey = code;
    } else if (imageRemoved) {
      await deleteImage(code);
      record.photoKey = null;
    }
  } catch (error) {
    showMessage(`No se pudo guardar la fotografía: ${error.message}`, "error");
    return;
  }

  if (oldRecord) {
    activities = activities.map((item) => item.code === code ? record : item);
  } else {
    activities.push(record);
  }
  if (!persistActivities()) return;
  renderRecords();
  clearForm(false);
  showMessage(`${code} ${oldRecord ? "se actualizó" : "se registró"} correctamente.`, "success");
}

function fillDemo() {
  clearForm(false);
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  document.querySelector("#date").value = localDate;
  document.querySelector("#area").value = "Área deportiva";
  document.querySelector("#activityName").value = "Jornada de entrenamiento de menores";
  document.querySelector("#description").value = "Desarrollo de una jornada de entrenamiento para menores.";
  document.querySelector("#activityLead").value = "Responsable de demostración";
  document.querySelector("#status").value = "Finalizada";
  document.querySelector("#agreements").value = "Se revisarán los materiales antes de la siguiente actividad.";
  document.querySelector("#observations").value = "Se requiere verificar la disponibilidad de materiales para la próxima jornada.";
  document.querySelector("#tasks").value = "Confirmar los materiales necesarios para la siguiente actividad.";
  document.querySelector("#followupOwner").value = "Coordinador de la actividad";
  document.querySelector("#followupDate").value = "";
  setDemoMode(true);
  updateCode();
  showMessage("Ejemplo ficticio cargado. Revísalo y pulsa Registrar actividad para guardarlo.", "success");
  document.querySelector("#activityName").focus();
}

async function editRecord(code) {
  const item = activities.find((record) => record.code === code);
  if (!item) return;
  clearForm(false);
  editingCode = item.code;
  codeInput.value = item.code;
  const fields = ["date", "startTime", "endTime", "area", "activityName", "description", "activityLead", "status", "agreements", "observations", "tasks", "followupOwner", "followupDate"];
  fields.forEach((field) => { form.elements[field].value = item[field] || ""; });
  saveButton.innerHTML = '<span aria-hidden="true">✓</span> Guardar cambios';
  editHint.hidden = false;
  setDemoMode(Boolean(item.isDemo));
  hideMessage();

  if (item.photoKey) {
    try {
      const savedImage = await getImage(item.photoKey);
      if (savedImage) updatePreview(savedImage.blob, savedImage.name);
    } catch (error) {
      showMessage("No se pudo recuperar la fotografía guardada. Los demás datos sí están disponibles.", "error");
    }
  }
  detailsDialog.close();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#activityName").focus({ preventScroll: true });
}

function addDetailItem(grid, label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "detail-item";
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value || "No especificado";
  wrapper.append(term, description);
  grid.append(wrapper);
}

function addDetailSection(title, entries) {
  const section = document.createElement("section");
  section.className = "detail-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const grid = document.createElement("dl");
  grid.className = "detail-grid";
  entries.forEach(([label, value]) => addDetailItem(grid, label, value));
  section.append(heading, grid);
  detailBody.append(section);
}

async function viewRecord(code) {
  const item = activities.find((record) => record.code === code);
  if (!item) return;
  currentDetailsCode = code;
  document.querySelector("#detailsTitle").textContent = `${item.code} · ${item.activityName}`;
  detailBody.replaceChildren();
  addDetailSection("Actividad", [
    ["Fecha", formatDate(item.date)],
    ["Horario", [item.startTime, item.endTime].filter(Boolean).join(" - ") || "No especificado"],
    ["Área responsable", item.area],
    ["Descripción", item.description],
    ["Responsable de la actividad", item.activityLead],
    ["Estado", item.status]
  ]);
  addDetailSection("Acuerdos y observaciones", [
    ["Acuerdos establecidos", item.agreements],
    ["Observaciones o incidencias", item.observations]
  ]);
  addDetailSection("Seguimiento", [
    ["Tareas pendientes", item.tasks],
    ["Responsable del seguimiento", item.followupOwner],
    ["Fecha prevista", formatDate(item.followupDate)]
  ]);
  if (item.isDemo) {
    const note = document.createElement("p");
    note.className = "demo-banner";
    note.textContent = "Registro ficticio para demostración académica; no representa una actividad real.";
    detailBody.prepend(note);
  }
  if (item.photoKey) {
    try {
      const savedImage = await getImage(item.photoKey);
      if (savedImage) {
        dialogImageUrl = URL.createObjectURL(savedImage.blob);
        const image = document.createElement("img");
        image.className = "detail-photo";
        image.src = dialogImageUrl;
        image.alt = `Evidencia fotográfica de ${item.activityName}`;
        detailBody.append(image);
      }
    } catch (error) {
      console.warn("No se pudo mostrar la fotografía:", error);
    }
  }
  detailsDialog.showModal();
}

async function removeRecord(code) {
  const item = activities.find((record) => record.code === code);
  if (!item || !window.confirm(`¿Eliminar el registro ${item.code} (${item.activityName})? Esta acción no se puede deshacer.`)) return;
  activities = activities.filter((record) => record.code !== code);
  if (!persistActivities()) return;
  await deleteImage(code);
  renderRecords();
  showMessage(`${code} se eliminó correctamente.`, "success");
}

function getFormRecordForPdf() {
  const code = editingCode || nextCode();
  const previous = activities.find((item) => item.code === code);
  const record = { ...previous, ...collectFormData(code), photoKey: previous?.photoKey || null };
  return record;
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer la fotografía para el PDF."));
    reader.readAsDataURL(blob);
  });
}

async function getRecordImage(record) {
  if (selectedImage) return selectedImage;
  if (imageRemoved || !record.photoKey) return null;
  const stored = await getImage(record.photoKey);
  return stored?.blob || null;
}

async function generatePdf(record, imageBlob = null) {
  if (!window.jspdf?.jsPDF) {
    showMessage("La biblioteca de PDF no se cargó. Conéctate a internet y vuelve a intentarlo.", "error");
    return;
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const usableWidth = pageWidth - margin * 2;
  let cursorY = 19;

  pdf.setFillColor(140, 29, 44);
  pdf.rect(0, 0, pageWidth, 7, "F");
  pdf.setTextColor(35, 38, 40);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(17);
  const titleLines = pdf.splitTextToSize("Reporte de registro y seguimiento de actividades", usableWidth);
  pdf.text(titleLines, margin, cursorY);
  cursorY += titleLines.length * 7 + 2;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(91, 98, 101);
  pdf.text("Escuela de Fútbol de Menores FBC Melgar", margin, cursorY);
  cursorY += 7;
  pdf.setDrawColor(220, 222, 222);
  pdf.line(margin, cursorY, pageWidth - margin, cursorY);
  cursorY += 8;

  function ensureSpace(height) {
    if (cursorY + height > pageHeight - 17) {
      pdf.addPage();
      cursorY = 18;
    }
  }

  function addSection(title) {
    ensureSpace(13);
    pdf.setFillColor(248, 233, 235);
    pdf.rect(margin, cursorY - 4, usableWidth, 8, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(140, 29, 44);
    pdf.text(title, margin + 2, cursorY + 1.5);
    cursorY += 11;
  }

  function addField(label, value) {
    const content = String(value || "No especificado");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(54, 59, 62);
    const labelLines = pdf.splitTextToSize(label, usableWidth);
    ensureSpace(labelLines.length * 4 + 9);
    pdf.text(labelLines, margin, cursorY);
    cursorY += labelLines.length * 4 + 1;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(70, 76, 79);
    const lines = pdf.splitTextToSize(content, usableWidth);
    const lineHeight = 4.5;
    for (const line of lines) {
      ensureSpace(lineHeight);
      pdf.text(line, margin, cursorY);
      cursorY += lineHeight;
    }
    cursorY += 2;
  }

  addField("Código del registro", record.code);
  addField("Fecha de generación", new Intl.DateTimeFormat("es-PE", { dateStyle: "long", timeStyle: "short" }).format(new Date()));
  addSection("Datos de la actividad");
  addField("Fecha de la actividad", formatDate(record.date));
  addField("Horario", [record.startTime, record.endTime].filter(Boolean).join(" - "));
  addField("Área responsable", record.area);
  addField("Nombre de la actividad", record.activityName);
  addField("Descripción", record.description);
  addField("Responsable de la actividad", record.activityLead);
  addField("Estado", record.status);
  addSection("Acuerdos y observaciones");
  addField("Acuerdos establecidos", record.agreements);
  addField("Observaciones o incidencias", record.observations);
  addSection("Seguimiento");
  addField("Tareas pendientes", record.tasks);
  addField("Responsable del seguimiento", record.followupOwner);
  addField("Fecha prevista para el seguimiento", formatDate(record.followupDate));

  if (record.isDemo) {
    addSection("Aviso de demostración");
    addField("Naturaleza del registro", "Información ficticia para una demostración académica. No representa una actividad real de la organización.");
  }

  if (imageBlob) {
    try {
      const dataUrl = await readBlobAsDataUrl(imageBlob);
      const imageProperties = pdf.getImageProperties(dataUrl);
      const maxWidth = usableWidth;
      const maxHeight = 90;
      const scale = Math.min(maxWidth / imageProperties.width, maxHeight / imageProperties.height, 1);
      const imageWidth = imageProperties.width * scale;
      const imageHeight = imageProperties.height * scale;
      ensureSpace(imageHeight + 18);
      addSection("Evidencia fotográfica");
      ensureSpace(imageHeight + 2);
      pdf.addImage(dataUrl, imageProperties.fileType, margin, cursorY, imageWidth, imageHeight);
      cursorY += imageHeight + 7;
    } catch (error) {
      console.error(error);
      showMessage("El reporte se generó sin la fotografía porque no se pudo procesar la imagen.", "error");
    }
  }

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(220, 222, 222);
    pdf.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(120, 126, 129);
    pdf.text("Prototipo académico · FBC Melgar", margin, pageHeight - 7);
    pdf.text(`Página ${page} de ${pageCount}`, pageWidth - margin, pageHeight - 7, { align: "right" });
  }
  pdf.save(`Reporte_${record.code}.pdf`);
}

async function handleDraftPdf() {
  hideMessage();
  if (!validateForm()) return;
  if (selectedImage && !validImage(selectedImage)) return;
  try {
    const record = getFormRecordForPdf();
    const image = await getRecordImage(record);
    await generatePdf(record, image);
  } catch (error) {
    showMessage(`No se pudo preparar el PDF: ${error.message}`, "error");
  }
}

async function handleSavedPdf(code) {
  const record = activities.find((item) => item.code === code);
  if (!record) return;
  try {
    const stored = record.photoKey ? await getImage(record.photoKey) : null;
    await generatePdf(record, stored?.blob || null);
  } catch (error) {
    showMessage(`No se pudo preparar el PDF: ${error.message}`, "error");
  }
}

async function clearDemoRecords() {
  const demoRecords = activities.filter((item) => item.isDemo);
  if (!demoRecords.length) {
    showMessage("No hay registros ficticios guardados para eliminar.", "success");
    return;
  }
  if (!window.confirm(`Se eliminarán ${demoRecords.length} registro(s) ficticio(s). Los registros normales se conservarán. ¿Continuar?`)) return;
  activities = activities.filter((item) => !item.isDemo);
  if (!persistActivities()) return;
  await Promise.all(demoRecords.map((item) => deleteImage(item.code)));
  renderRecords();
  showMessage("Se eliminaron los registros ficticios. Los demás registros se conservaron.", "success");
}

form.addEventListener("submit", handleSubmit);
document.querySelector("#clearButton").addEventListener("click", () => clearForm(true));
document.querySelector("#pdfDraftButton").addEventListener("click", handleDraftPdf);
document.querySelector("#loadDemoButton").addEventListener("click", fillDemo);
document.querySelector("#clearDemoButton").addEventListener("click", clearDemoRecords);
document.querySelector("#searchInput").addEventListener("input", renderRecords);
document.querySelector("#statusFilter").addEventListener("change", renderRecords);

photoInput.addEventListener("change", () => {
  hideMessage();
  const file = photoInput.files[0];
  if (!file) return;
  if (!validImage(file)) {
    photoInput.value = "";
    selectedImage = null;
    return;
  }
  selectedImage = file;
  imageRemoved = false;
  updatePreview(file, file.name);
});

document.querySelector("#removePhotoButton").addEventListener("click", () => {
  photoInput.value = "";
  selectedImage = null;
  imageRemoved = true;
  updatePreview(null);
});

recordList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, code } = button.dataset;
  if (action === "view") viewRecord(code);
  if (action === "edit") editRecord(code);
  if (action === "pdf") handleSavedPdf(code);
  if (action === "delete") removeRecord(code);
});

followupList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action=" + '"view"' + "]");
  if (button) viewRecord(button.dataset.code);
});

document.querySelector("#closeDetailsButton").addEventListener("click", () => detailsDialog.close());
document.querySelector("#detailsPdfButton").addEventListener("click", () => {
  if (currentDetailsCode) handleSavedPdf(currentDetailsCode);
});
document.querySelector("#detailsEditButton").addEventListener("click", () => {
  if (currentDetailsCode) editRecord(currentDetailsCode);
});
detailsDialog.addEventListener("close", () => {
  if (dialogImageUrl) URL.revokeObjectURL(dialogImageUrl);
  dialogImageUrl = null;
});
detailsDialog.addEventListener("click", (event) => {
  if (event.target === detailsDialog) detailsDialog.close();
});

updateCode();
renderRecords();
