// script.js

const fileInput = document.getElementById("file");
const uploadBtn = document.getElementById("uploadBtn");
const uploadStatus = document.getElementById("uploadStatus");

const datasetSelect = document.getElementById("dataset");
const datasetInfo = document.getElementById("datasetInfo");
const loadBtn = document.getElementById("loadBtn");
const deleteBtn = document.getElementById("deleteBtn");

const dataTable = document.getElementById("dataTable");
const thead = dataTable.querySelector("thead");
const tbody = dataTable.querySelector("tbody");
const countPill = document.getElementById("countPill");

const filtersDiv = document.getElementById("filters");
const addFilterBtn = document.getElementById("addFilter");
const applyFiltersBtn = document.getElementById("applyFilters");
const clearFiltersBtn = document.getElementById("clearFilters");
const filterInfo = document.getElementById("filterInfo");

let currentRows = [];
let filteredRows = [];
let currentColumns = [];

// Helpers
function setStatus(el, msg, type = "") {
  el.textContent = msg;
  el.className = "status" + (type ? " " + type : "");
}

function deduceColumns(rows) {
  const set = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => set.add(k)));
  set.delete("id");
  return Array.from(set);
}

function renderTable(rows, columns) {
  thead.innerHTML = "";
  const trHead = document.createElement("tr");
  columns.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  tbody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    columns.forEach(col => {
      const td = document.createElement("td");
      let val = r[col];
      if (val instanceof Date) val = val.toISOString();
      if (Array.isArray(val)) val = val.join(", ");
      if (typeof val === "object" && val !== null) val = JSON.stringify(val);
      td.textContent = val ?? "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  countPill.textContent = "Rows: " + rows.length;
}

function populateDatasetSelect(datasets) {
  datasetSelect.innerHTML = "";
  if (!datasets.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No datasets";
    datasetSelect.appendChild(opt);
    return;
  }
  datasets.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = `${d.originalname} (#${d.id})`;
    datasetSelect.appendChild(opt);
  });
}

async function fetchDatasets() {
  try {
    const res = await fetch("/datasets");
    const data = await res.json();
    populateDatasetSelect(data);
    setStatus(datasetInfo, `Found ${data.length} dataset(s).`);
  } catch {
    setStatus(datasetInfo, "Failed to fetch datasets", "bad");
  }
}

async function fetchRows(datasetId) {
  try {
    const res = await fetch(`/rows?dataset_id=${encodeURIComponent(datasetId)}`);
    return await res.json();
  } catch {
    return [];
  }
}

// Multiple filter support
function createFilterRow() {
  const row = document.createElement("div");
  row.className = "row";

  const colSelect = document.createElement("select");
  currentColumns.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    colSelect.appendChild(opt);
  });

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Contains...";

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "✕";
  removeBtn.style.background = "#f85149";
  removeBtn.onclick = () => row.remove();

  row.appendChild(colSelect);
  row.appendChild(input);
  row.appendChild(removeBtn);

  filtersDiv.appendChild(row);
}

// Event listeners
uploadBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    setStatus(uploadStatus, "Please select an Excel file", "bad");
    return;
  }
  uploadBtn.disabled = true;
  setStatus(uploadStatus, "Uploading...");

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/upload", { method: "POST", body: formData });
    const data = await res.json();
    if (res.ok) {
      setStatus(uploadStatus, `Uploaded. Rows saved: ${data.rows_saved}`, "ok");
      await fetchDatasets();
      datasetSelect.value = data.dataset_id;
    } else {
      setStatus(uploadStatus, data.error || "Upload failed", "bad");
    }
  } catch {
    setStatus(uploadStatus, "Upload error", "bad");
  } finally {
    uploadBtn.disabled = false;
  }
});

loadBtn.addEventListener("click", async () => {
  const id = datasetSelect.value;
  if (!id) {
    setStatus(datasetInfo, "Select a dataset first", "bad");
    return;
  }
  setStatus(datasetInfo, "Loading rows...");
  currentRows = await fetchRows(id);
  currentColumns = deduceColumns(currentRows);
  filteredRows = [...currentRows];
  renderTable(filteredRows, currentColumns);
  setStatus(datasetInfo, `Loaded ${currentRows.length} rows.`, "ok");
});

deleteBtn.addEventListener("click", async () => {
  const id = datasetSelect.value;
  if (!id) {
    setStatus(datasetInfo, "Select a dataset to delete", "bad");
    return;
  }
  if (!confirm("Delete this dataset and its file?")) return;
  try {
    const res = await fetch(`/datasets/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) {
      setStatus(datasetInfo, "Deleted dataset.", "ok");
      await fetchDatasets();
      currentRows = [];
      filteredRows = [];
      currentColumns = [];
      renderTable([], []);
    } else {
      setStatus(datasetInfo, data.error || "Delete failed", "bad");
    }
  } catch {
    setStatus(datasetInfo, "Delete error", "bad");
  }
});

addFilterBtn.addEventListener("click", () => {
  if (currentColumns.length === 0) {
    setStatus(filterInfo, "Load data first", "bad");
    return;
  }
  createFilterRow();
});

applyFiltersBtn.addEventListener("click", () => {
  const filterRows = filtersDiv.querySelectorAll(".row");
  if (!filterRows.length) {
    setStatus(filterInfo, "No filters added", "bad");
    return;
  }

  filteredRows = currentRows.filter(r => {
    return Array.from(filterRows).every(row => {
      const col = row.querySelector("select").value;
      const q = row.querySelector("input").value.trim().toLowerCase();
      if (!q) return true;
      const val = r[col];
      return val !== undefined && String(val).toLowerCase().includes(q);
    });
  });

  renderTable(filteredRows, currentColumns);
  setStatus(filterInfo, `Applied ${filterRows.length} filter(s). ${filteredRows.length} match(es).`, "ok");
});

clearFiltersBtn.addEventListener("click", () => {
  filtersDiv.innerHTML = "";
  filteredRows = [...currentRows];
  renderTable(filteredRows, currentColumns);
  setStatus(filterInfo, "Filters cleared.", "");
});

// Init
fetchDatasets();