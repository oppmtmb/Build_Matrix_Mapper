import React, { useState, useRef } from "react";
import { 
  Upload, 
  FileSpreadsheet, 
  Download, 
  AlertTriangle, 
  CheckCircle2, 
  Trash2, 
  Info, 
  Check, 
  X, 
  Layers, 
  Table, 
  FileText,
  RefreshCw,
  HelpCircle,
  FileCheck,
  ChevronRight
} from "lucide-react";
import * as XLSX from "xlsx";
import { 
  parseLVBuildMatrix, 
  buildExportRow, 
  generateExportCsv, 
  EXPORT_HEADERS, 
  ParsedBuild,
  applyPartPrefix
} from "./utils/parser";

export default function App() {
  const [builds, setBuilds] = useState<ParsedBuild[]>([]);
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingColName, setEditingColName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const selectedBuild = builds.find(b => b.id === selectedBuildId) || builds[0] || null;

  // File loading handler
  const handleFiles = (files: FileList) => {
    const newBuilds: ParsedBuild[] = [];
    let processedCount = 0;

    const isValidParsedBuild = (build: ParsedBuild) => {
      return (
        build.bomRows.length > 0 ||
        Boolean(build.projectName) ||
        Boolean(build.sku) ||
        Boolean(build.a190) ||
        Boolean(build.a198) ||
        Boolean(build.capacity) ||
        Object.values(build.mappedComponents).some(val => val !== null)
      );
    };

    const processCsvText = (csvText: string, label: string, sheetName?: string) => {
      if (!csvText || !csvText.trim()) return;

      const lowerCsv = csvText.toLowerCase();
      const lowerSheet = (sheetName || "").toLowerCase();

      const isLeg2Sheet = /leg\s*2|leg2|\bl2\b/i.test(lowerSheet) && !/leg\s*1|leg1|\bl1\b/i.test(lowerSheet);
      const isLeg1Sheet = /leg\s*1|leg1|\bl1\b/i.test(lowerSheet) && !/leg\s*2|leg2|\bl2\b/i.test(lowerSheet);
      const hasLeg2 = lowerCsv.includes("leg 2") || lowerCsv.includes("leg2") || lowerCsv.includes("leg 3") || lowerCsv.includes("leg3");

      if (isLeg2Sheet) {
        const parsedLeg2 = parseLVBuildMatrix(csvText, label, 2);
        if (parsedLeg2 && isValidParsedBuild(parsedLeg2)) {
          newBuilds.push(parsedLeg2);
        }
      } else if (isLeg1Sheet) {
        const parsedLeg1 = parseLVBuildMatrix(csvText, label, 1);
        if (parsedLeg1 && isValidParsedBuild(parsedLeg1)) {
          newBuilds.push(parsedLeg1);
        }
      } else {
        // Parse Leg 1
        const parsedLeg1 = parseLVBuildMatrix(csvText, label, 1);
        if (parsedLeg1 && isValidParsedBuild(parsedLeg1)) {
          newBuilds.push(parsedLeg1);
        }

        // If spreadsheet content contains multi-leg structures, also parse Leg 2
        if (hasLeg2) {
          const parsedLeg2 = parseLVBuildMatrix(csvText, label, 2);
          if (parsedLeg2 && isValidParsedBuild(parsedLeg2)) {
            newBuilds.push(parsedLeg2);
          }
        }
      }
    };

    Array.from(files).forEach((file) => {
      const isCsv = file.name.toLowerCase().endsWith(".csv");
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          if (isCsv) {
            const csvText = e.target?.result as string;
            processCsvText(csvText, file.name);
          } else {
            const buffer = e.target?.result as ArrayBuffer;
            if (buffer) {
              const data = new Uint8Array(buffer);
              const workbook = XLSX.read(data, { type: "array" });
              const sheetNames = workbook.SheetNames || [];
              const isMultiSheet = sheetNames.length > 1;

              sheetNames.forEach((sheetName) => {
                const worksheet = workbook.Sheets[sheetName];
                if (!worksheet) return;

                const csvText = XLSX.utils.sheet_to_csv(worksheet);
                const label = sheetName?.trim() || file.name;
                processCsvText(csvText, label, sheetName);
              });
            }
          }
        } catch (err) {
          console.error(`Error parsing file ${file.name}: `, err);
        }

        processedCount++;
        if (processedCount === files.length) {
          setBuilds(prev => {
            const combined = [...prev, ...newBuilds];
            if (combined.length > 0 && !selectedBuildId) {
              setSelectedBuildId(combined[0].id);
            }
            return combined;
          });
        }
      };

      if (isCsv) {
        reader.readAsText(file);
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  };

  // Drag and drop event handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  };

  // Delete a build from state
  const handleDeleteBuild = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBuilds(prev => {
      const filtered = prev.filter(b => b.id !== id);
      if (selectedBuildId === id) {
        setSelectedBuildId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
  };

  // Clear all uploaded builds
  const handleClearAll = () => {
    setBuilds([]);
    setSelectedBuildId(null);
    setValidationErrors([]);
  };

  // Modify individual parsed fields (live reactive validation and customization)
  const handleFieldChange = (buildId: string, field: keyof ParsedBuild, value: any) => {
    setBuilds(prev => prev.map(b => {
      if (b.id !== buildId) return b;
      
      const updated = { ...b, [field]: value };
      
      // If we are changing project, stage or form-factor, boost confidence if done manually
      if (field === 'projectName') updated.projectConfidence = 'high';
      if (field === 'stage') updated.stageConfidence = 'high';
      if (field === 'ff') updated.ffConfidence = 'high';

      return updated;
    }));
  };

  // Save user override for a specific column/cell in the selected build
  const handleCellOverride = (colName: string, newValue: string) => {
    if (!selectedBuild) return;
    setBuilds(prev => prev.map(b => {
      if (b.id !== selectedBuild.id) return b;
      const updatedOverrides = { ...(b.overrides || {}), [colName]: newValue };
      return { ...b, overrides: updatedOverrides };
    }));
    setEditingColName(null);
  };

  // Revert a column/cell to its original auto-parsed value
  const handleCellRevert = (colName: string) => {
    if (!selectedBuild) return;
    setBuilds(prev => prev.map(b => {
      if (b.id !== selectedBuild.id) return b;
      const updatedOverrides = { ...(b.overrides || {}) };
      delete updatedOverrides[colName];
      return { ...b, overrides: updatedOverrides };
    }));
  };

  // Calculate fields categorization summary for UI display
  const getBuildSummaryStats = (build: ParsedBuild) => {
    let verifiedCount = 0; // Populated from source data (Green)
    let lowConfidenceCount = 0; // Stage, FF, Project check (Yellow)
    let blankCount = 0; // Left blank (Gray)

    EXPORT_HEADERS.forEach(col => {
      // 1. Check blank fields with no reliable source
      const blankHeaders = [
        "Gen", "Check code", "DCN/ECR-1", "DCN/ECR-2", "Build Date-1", 
        "Build Date-2", "825* PN", "WO#-1", "WO#-2", "Build#"
      ];
      if (blankHeaders.includes(col)) {
        blankCount++;
        return;
      }

      // 2. Check low confidence fields
      if (col === "Stage") {
        if (build.stageConfidence === "low") lowConfidenceCount++;
        else verifiedCount++;
        return;
      }
      if (col === "FF") {
        if (build.ffConfidence === "low") lowConfidenceCount++;
        else verifiedCount++;
        return;
      }
      if (col === "Project") {
        if (build.projectConfidence === "low" || !build.projectName) lowConfidenceCount++;
        else verifiedCount++;
        return;
      }

      // 3. Check matched components or header metadata
      const isMappedComponent = build.mappedComponents[col] !== null;
      const isPopulatedMeta = [
        "Leg#", "Sandisk PN", "9* PN", "Qty-1", "Qty-2", "Remark", "WD PN", "Capacity"
      ].includes(col);

      if (isMappedComponent || isPopulatedMeta) {
        verifiedCount++;
      } else {
        blankCount++;
      }
    });

    return { verifiedCount, lowConfidenceCount, blankCount };
  };

  // Validate all builds against target rules
  const validateBuilds = (): boolean => {
    const errors: string[] = [];

    builds.forEach((build, idx) => {
      const fileLabel = `[File #${idx + 1}: ${build.filename}]`;
      
      // Rule 1: Project must be "Carrera", "Enzo", or blank ONLY
      const validProjects = ["Carrera", "Enzo", ""];
      if (!validProjects.includes(build.projectName)) {
        errors.push(`${fileLabel} Project name must be "Carrera", "Enzo", or left completely blank. Currently set to "${build.projectName}".`);
      }

      // Rule 2: BGA column must never be labeled NAND (validated against export headers list)
      const bgaIndex = EXPORT_HEADERS.indexOf("BGA");
      const nandIndex = EXPORT_HEADERS.findIndex(h => h.toLowerCase() === "nand");
      if (nandIndex !== -1) {
        errors.push("Internal Error: Output contains 'NAND' column. SNDK Matrix strictly requires column header to be 'BGA'.");
      }
    });

    setValidationErrors(errors);
    return errors.length === 0;
  };

  // Download Action
  const handleExport = () => {
    if (builds.length === 0) return;

    const isValid = validateBuilds();
    if (!isValid) {
      // Scroll to validation errors
      const errEl = document.getElementById("validation-panel");
      errEl?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    try {
      const csvContent = generateExportCsv(builds);
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      
      // Default export filename based on first loaded project, or default mapper name
      const firstProj = builds[0].projectName || "unspecified";
      const timestamp = new Date().toISOString().slice(0, 10);
      link.setAttribute("href", url);
      link.setAttribute("download", `SNDK_Build_Matrix_${firstProj}_${timestamp}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      alert("Failed to export CSV: " + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-primary font-sans selection:bg-brand-accent/30 selection:text-brand-primary" id="main-container">
      {/* Upper Navigation/Header Bar */}
      <header className="border-b border-brand-border bg-brand-surface/80 backdrop-blur sticky top-0 z-10 px-6 py-4" id="app-header">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-brand-accent/10 p-2 rounded-lg text-brand-accent border border-brand-accent/20 shadow-sm">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2 font-display">
                SNDK Build Matrix Mapper
                <span className="text-[10px] uppercase font-mono tracking-widest bg-brand-accent/10 text-brand-accent border border-brand-accent/20 px-2 py-0.5 rounded-full">
                  v1.2 Live
                </span>
              </h1>
              <p className="text-xs text-brand-primary/60 mt-0.5">
                Line Validation Build Matrix BOM (CSV) to flat SNDK Update format
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              id="help-btn"
              onClick={() => setShowHelpModal(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-brand-primary bg-brand-surface hover:bg-brand-border border border-brand-border transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <HelpCircle className="h-3.5 w-3.5 text-brand-accent" />
              Mapping Rules Reference
            </button>
            {builds.length > 0 && (
              <button
                id="clear-all-btn"
                onClick={handleClearAll}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-brand-danger hover:bg-brand-danger/10 transition-all border border-transparent hover:border-brand-danger/20 cursor-pointer"
              >
                Clear All ({builds.length})
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-8" id="app-content">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInput}
          multiple
          accept=".csv,.xlsx,.xls,.xlsm,.xlsb"
          className="hidden"
        />
        
        {/* Drag and Drop Zone / Empty State */}
        {builds.length === 0 ? (
          <div 
            id="drag-drop-zone"
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 flex flex-col items-center justify-center min-h-[450px] ${
              dragActive 
                ? "border-brand-accent bg-brand-accent/5 shadow-lg shadow-brand-accent/5 scale-[1.01]" 
                : "border-brand-border bg-brand-surface/20 hover:border-brand-accent/50 hover:bg-brand-surface/40"
            }`}
          >
            <div className="w-16 h-16 rounded-2xl bg-brand-accent/10 border border-brand-accent/20 flex items-center justify-center mb-6 text-brand-accent">
              <Upload className="h-8 w-8 animate-pulse" />
            </div>
             <h3 className="text-lg font-medium text-white mb-2 font-display">
              Upload QSI/WD Line Validation CSVs or Excel Sheets
            </h3>
            <p className="text-brand-primary/60 max-w-md text-sm mb-6 leading-relaxed">
              Drag & drop one or multiple LV Build Matrix files (CSV or Excel formats), or select from your local device. 
              The mapper automatically extracts header details and aligns PCB reference designators.
            </p>
            
            <div className="flex flex-col items-center gap-3">
              <button
                id="select-file-btn"
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-2.5 rounded-xl bg-brand-accent hover:bg-brand-accent-hover text-black text-sm font-semibold transition-all shadow-md flex items-center gap-2 cursor-pointer"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Select CSV / Excel Files
              </button>
              <span className="text-[11px] font-mono text-brand-primary/40">Supports Excel (.xlsx, .xls, .xlsm, .xlsb) and stacked BOM CSV formats</span>
            </div>

            {/* Quick Sample Preview Helper */}
            <div className="mt-12 pt-8 border-t border-brand-border w-full max-w-2xl text-left grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-brand-surface border border-brand-border">
                <h4 className="text-xs font-mono text-brand-accent uppercase tracking-wider mb-2 font-semibold">Automated Extraction</h4>
                <p className="text-xs text-brand-primary/60 leading-relaxed">
                  Key metadata including <strong>SKU, A198 (prefixed with 9W0), A190, PS/SS, Build Qty,</strong> and <strong>Capacity</strong> are parsed directly from the top block.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-brand-surface border border-brand-border">
                <h4 className="text-xs font-mono text-brand-accent uppercase tracking-wider mb-2 font-semibold">PCB Ref-Des Mapping</h4>
                <p className="text-xs text-brand-primary/60 leading-relaxed">
                  Matches physical locations (e.g., <strong>U121, U123, U149, U150, U151, X1, U10-U13, U100-U103</strong>) against SNDK columns using robust multi-line layout mappings.
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Multi-Build Content View */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="loaded-content-grid">
            
            {/* Sidebar / List of loaded builds */}
            <div className="lg:col-span-3 space-y-4" id="sidebar-panel">
              <div className="bg-brand-surface rounded-xl border border-brand-border p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-brand-border">
                  <span className="text-xs font-semibold uppercase tracking-wider text-brand-primary/60">
                    Source Builds ({builds.length})
                  </span>
                  <button 
                    id="add-more-btn"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-brand-accent hover:text-brand-accent-hover font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    + Add More
                  </button>
                </div>

                <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1" id="builds-list">
                  {builds.map((build, index) => {
                    const isSelected = selectedBuild?.id === build.id;
                    const stats = getBuildSummaryStats(build);
                    return (
                      <div
                        key={build.id}
                        id={`build-item-${index}`}
                        onClick={() => setSelectedBuildId(build.id)}
                        className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                          isSelected 
                            ? "bg-brand-bg border-brand-accent shadow-sm" 
                            : "bg-brand-surface/40 border-brand-border hover:bg-brand-bg/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium text-brand-primary truncate max-w-[150px]" title={build.filename}>
                            {build.filename}
                          </p>
                          <button
                            id={`delete-build-${index}`}
                            onClick={(e) => handleDeleteBuild(build.id, e)}
                            className="p-1 rounded text-brand-primary/40 hover:text-brand-danger hover:bg-brand-danger/10 transition-all cursor-pointer"
                            title="Remove from batch"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[10px] font-mono bg-brand-bg text-brand-primary/80 border border-brand-border px-1.5 py-0.5 rounded">
                            {build.projectName || "Unknown Proj"}
                          </span>
                          <span className="text-[10px] font-mono text-brand-accent font-semibold">
                            {build.legNum}
                          </span>
                        </div>

                        {/* Staged values helper indicator */}
                        <div className="flex items-center gap-1.5 mt-2 pt-1.5 border-t border-brand-border text-[10px] text-brand-primary/50">
                          <span className="text-brand-accent font-medium">{stats.verifiedCount} verified</span>
                          <span>•</span>
                          <span className="text-brand-warning font-medium">{stats.lowConfidenceCount} verify</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Board */}
              <div className="bg-brand-surface rounded-xl border border-brand-border p-4 space-y-4 shadow-sm">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-primary/60">Export Controls</h4>
                <div className="space-y-2">
                  <button
                    id="export-csv-btn"
                    onClick={handleExport}
                    className="w-full py-3 px-4 rounded-xl bg-brand-accent hover:bg-brand-accent-hover text-black font-bold text-sm transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    Export Clean CSV
                  </button>
                  <p className="text-[10px] text-brand-primary/50 text-center leading-relaxed">
                    Downloads a clean flat 62-column CSV containing all parsed builds aligned perfectly.
                  </p>
                </div>

                {/* Live validation summary status inside export controls */}
                <div className="pt-2 border-t border-brand-border space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-brand-primary/60">Project Name Rule:</span>
                    <span className="text-brand-accent flex items-center gap-1 font-semibold">
                      <Check className="h-3 w-3" /> Strict
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-brand-primary/60">NAND Label Rule:</span>
                    <span className="text-brand-accent flex items-center gap-1 font-semibold">
                      <Check className="h-3 w-3" /> "BGA" only
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Main view for selected build */}
            <div className="lg:col-span-9 space-y-6" id="build-details-panel">
              {selectedBuild ? (
                <>
                  {/* File Metadata Overview / Interactive Editor */}
                  <div className="bg-brand-surface rounded-2xl border border-brand-border p-6 space-y-6 shadow-sm" id="metadata-editor-card">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-brand-border">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-brand-accent bg-brand-accent/10 px-2 py-0.5 rounded border border-brand-accent/20">
                            Active Workspace File
                          </span>
                          <span className="text-xs font-mono text-brand-accent bg-brand-accent/10 px-2 py-0.5 rounded border border-brand-accent/20 font-semibold">
                            {selectedBuild.legNum}
                          </span>
                        </div>
                        <h2 className="text-lg font-bold text-white mt-1.5 truncate max-w-xl font-display">
                          {selectedBuild.filename}
                        </h2>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-brand-primary/60">Set Sequence Index:</span>
                        <select
                          id="leg-sequence-select"
                          value={selectedBuild.legNum}
                          onChange={(e) => handleFieldChange(selectedBuild.id, "legNum", e.target.value)}
                          className="bg-brand-bg border border-brand-border text-xs text-brand-primary px-3 py-1.5 rounded-lg focus:outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/20 cursor-pointer"
                        >
                          {Array.from({ length: 12 }, (_, i) => `Leg ${i + 1}`).map(leg => (
                            <option key={leg} value={leg}>{leg}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Metadata Fields Form */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      
                      {/* Project Detection */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-brand-primary flex items-center justify-between">
                          <span>Project Name</span>
                          {selectedBuild.projectConfidence === "low" ? (
                            <span className="text-[10px] text-brand-warning bg-brand-warning/10 px-1.5 py-0.5 rounded flex items-center gap-0.5 border border-brand-warning/20">
                              <AlertTriangle className="h-2.5 w-2.5" /> Low Confidence
                            </span>
                          ) : (
                            <span className="text-[10px] text-brand-accent bg-brand-accent/10 px-1.5 py-0.5 rounded border border-brand-accent/20 font-semibold">Verified</span>
                          )}
                        </label>
                        <select
                          id="project-name-input"
                          value={selectedBuild.projectName}
                          onChange={(e) => handleFieldChange(selectedBuild.id, "projectName", e.target.value)}
                          className="w-full bg-brand-bg border border-brand-border rounded-xl px-3 py-2 text-sm text-brand-primary focus:outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/20 cursor-pointer"
                        >
                          <option value="">(Blank) - Unknown</option>
                          <option value="Carrera">Carrera</option>
                          <option value="Enzo">Enzo</option>
                        </select>
                        <p className="text-[10px] text-brand-primary/50 leading-relaxed">
                          Project name must be detected from the filename. Must be <strong>Carrera</strong> or <strong>Enzo</strong>.
                        </p>
                      </div>

                      {/* Stage Selection */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-brand-primary flex items-center justify-between">
                          <span>Stage</span>
                          {selectedBuild.stageConfidence === "low" ? (
                            <span className="text-[10px] text-brand-warning bg-brand-warning/10 px-1.5 py-0.5 rounded flex items-center gap-0.5 border border-brand-warning/20">
                              <AlertTriangle className="h-2.5 w-2.5" /> Verify / Edit
                            </span>
                          ) : (
                            <span className="text-[10px] text-brand-accent bg-brand-accent/10 px-1.5 py-0.5 rounded border border-brand-accent/20 font-semibold">Confirmed</span>
                          )}
                        </label>
                        <input
                          id="stage-input"
                          type="text"
                          value={selectedBuild.stage}
                          onChange={(e) => handleFieldChange(selectedBuild.id, "stage", e.target.value)}
                          placeholder="e.g. EVT, DVT, PVT, MP"
                          className="w-full bg-brand-bg border border-brand-border rounded-xl px-3 py-2 text-sm text-brand-primary focus:outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/20"
                        />
                        <p className="text-[10px] text-brand-primary/50 leading-relaxed">
                          Recovered from filename or headers. Confirm the stage of the build.
                        </p>
                      </div>

                      {/* Form Factor Selection */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-brand-primary flex items-center justify-between">
                          <span>Form Factor (FF)</span>
                          {selectedBuild.ffConfidence === "low" ? (
                            <span className="text-[10px] text-brand-warning bg-brand-warning/10 px-1.5 py-0.5 rounded flex items-center gap-0.5 border border-brand-warning/20">
                              <AlertTriangle className="h-2.5 w-2.5" /> Verify / Edit
                            </span>
                          ) : (
                            <span className="text-[10px] text-brand-accent bg-brand-accent/10 px-1.5 py-0.5 rounded border border-brand-accent/20 font-semibold">Confirmed</span>
                          )}
                        </label>
                        <input
                          id="ff-input"
                          type="text"
                          value={selectedBuild.ff}
                          onChange={(e) => handleFieldChange(selectedBuild.id, "ff", e.target.value)}
                          placeholder="e.g. U.2, M.2, E1.S, E3.S"
                          className="w-full bg-brand-bg border border-brand-border rounded-xl px-3 py-2 text-sm text-brand-primary focus:outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/20"
                        />
                        <p className="text-[10px] text-brand-primary/50 leading-relaxed">
                          Form Factor of target SSD build. Ensure it aligns correctly.
                        </p>
                      </div>

                    </div>

                    {/* Extracted CSV Keys Panel */}
                    <div className="p-4 rounded-xl bg-brand-bg border border-brand-border grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-brand-primary/60 block mb-1">Sandisk SKU / SKU:</span>
                        <input
                          id="sku-input"
                          type="text"
                          value={selectedBuild.sku}
                          onChange={(e) => handleFieldChange(selectedBuild.id, "sku", e.target.value)}
                          className="bg-transparent border-b border-brand-border hover:border-brand-primary/20 focus:border-brand-accent focus:outline-none py-0.5 w-full text-brand-primary font-mono transition-colors"
                        />
                      </div>
                      <div>
                        <span className="text-brand-primary/60 block mb-1">A198 (Raw):</span>
                        <input
                          id="a198-input"
                          type="text"
                          value={selectedBuild.a198}
                          onChange={(e) => handleFieldChange(selectedBuild.id, "a198", e.target.value)}
                          className="bg-transparent border-b border-brand-border hover:border-brand-primary/20 focus:border-brand-accent focus:outline-none py-0.5 w-full text-brand-primary font-mono transition-colors"
                        />
                      </div>
                      <div>
                        <span className="text-brand-primary/60 block mb-1">WD PN (A190):</span>
                        <input
                          id="a190-input"
                          type="text"
                          value={selectedBuild.a190}
                          onChange={(e) => handleFieldChange(selectedBuild.id, "a190", e.target.value)}
                          className="bg-transparent border-b border-brand-border hover:border-brand-primary/20 focus:border-brand-accent focus:outline-none py-0.5 w-full text-brand-primary font-mono transition-colors"
                        />
                      </div>
                      <div>
                        <span className="text-brand-primary/60 block mb-1">Capacity:</span>
                        <input
                          id="capacity-input"
                          type="text"
                          value={selectedBuild.capacity}
                          onChange={(e) => handleFieldChange(selectedBuild.id, "capacity", e.target.value)}
                          className="bg-transparent border-b border-brand-border hover:border-brand-primary/20 focus:border-brand-accent focus:outline-none py-0.5 w-full text-brand-primary font-mono transition-colors"
                        />
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-brand-bg border border-brand-border grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-brand-primary/60 block mb-1">PS/SS Side:</span>
                        <input
                          id="psss-input"
                          type="text"
                          value={selectedBuild.psSs}
                          onChange={(e) => handleFieldChange(selectedBuild.id, "psSs", e.target.value)}
                          className="bg-transparent border-b border-brand-border hover:border-brand-primary/20 focus:border-brand-accent focus:outline-none py-0.5 w-full text-brand-primary font-mono transition-colors"
                        />
                      </div>
                      <div>
                        <span className="text-brand-primary/60 block mb-1">DW/D Mode:</span>
                        <input
                          id="dwd-input"
                          type="text"
                          value={selectedBuild.dwD}
                          onChange={(e) => handleFieldChange(selectedBuild.id, "dwD", e.target.value)}
                          className="bg-transparent border-b border-brand-border hover:border-brand-primary/20 focus:border-brand-accent focus:outline-none py-0.5 w-full text-brand-primary font-mono transition-colors"
                        />
                      </div>
                      <div>
                        <span className="text-brand-primary/60 block mb-1">Build Qty:</span>
                        <input
                          id="build-qty-input"
                          type="text"
                          value={selectedBuild.buildQty}
                          onChange={(e) => handleFieldChange(selectedBuild.id, "buildQty", e.target.value)}
                          className="bg-transparent border-b border-brand-border hover:border-brand-primary/20 focus:border-brand-accent focus:outline-none py-0.5 w-full text-brand-primary font-mono transition-colors"
                        />
                      </div>
                      <div>
                        <span className="text-brand-primary/60 block mb-1">%OP Overprovision:</span>
                        <input
                          id="op-input"
                          type="text"
                          value={selectedBuild.opPercent}
                          onChange={(e) => handleFieldChange(selectedBuild.id, "opPercent", e.target.value)}
                          className="bg-transparent border-b border-brand-border hover:border-brand-primary/20 focus:border-brand-accent focus:outline-none py-0.5 w-full text-brand-primary font-mono transition-colors"
                        />
                      </div>
                    </div>

                    {/* Remarks Input */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-brand-primary block">
                        Constructed Remark (Set in both "Remark" and "REMARK")
                      </label>
                      <textarea
                        id="remark-input"
                        rows={2}
                        value={selectedBuild.remark}
                        onChange={(e) => handleFieldChange(selectedBuild.id, "remark", e.target.value)}
                        className="w-full bg-brand-bg border border-brand-border rounded-xl p-3 text-xs text-brand-primary focus:outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/20"
                        placeholder="Constructed auto-remark will be placed here"
                      />
                    </div>
                  </div>                  {/* Dynamic Confidence Score Panel */}
                  <div className="bg-brand-surface rounded-2xl border border-brand-border p-6 space-y-4 shadow-sm" id="confidence-summary-panel">
                    <div className="flex items-center justify-between pb-3 border-b border-brand-border">
                      <h3 className="text-sm font-semibold tracking-wide text-brand-primary flex items-center gap-2 font-display">
                        <Info className="h-4 w-4 text-brand-accent" />
                        SNDK Alignment Summary
                      </h3>
                      <span className="text-[11px] text-brand-primary/40">Calculated across 62 target columns</span>
                    </div>

                    {(() => {
                      const stats = getBuildSummaryStats(selectedBuild);
                      return (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="bg-brand-accent/5 border border-brand-accent/15 p-4 rounded-xl flex items-start gap-3">
                            <div className="bg-brand-accent/10 p-1.5 rounded text-brand-accent mt-0.5">
                              <CheckCircle2 className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-xs text-brand-accent font-semibold">Verified from Source</p>
                              <h4 className="text-2xl font-bold text-white mt-1 font-display">{stats.verifiedCount}</h4>
                              <p className="text-[10px] text-brand-primary/50 mt-1">Matched using keys or designator arrays.</p>
                            </div>
                          </div>

                          <div className="bg-brand-warning/5 border border-brand-warning/15 p-4 rounded-xl flex items-start gap-3">
                            <div className="bg-brand-warning/10 p-1.5 rounded text-brand-warning mt-0.5">
                              <AlertTriangle className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-xs text-brand-warning font-semibold">Verify / Check Code</p>
                              <h4 className="text-2xl font-bold text-white mt-1 font-display">{stats.lowConfidenceCount}</h4>
                              <p className="text-[10px] text-brand-primary/50 mt-1">Stage, FF, Project names mapped tentatively.</p>
                            </div>
                          </div>

                          <div className="bg-brand-surface border border-brand-border p-4 rounded-xl flex items-start gap-3">
                            <div className="bg-brand-primary/5 p-1.5 rounded text-brand-primary/40 mt-0.5">
                              <Layers className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-xs text-brand-primary/60 font-semibold">Left Blank</p>
                              <h4 className="text-2xl font-bold text-white mt-1 font-display">{stats.blankCount}</h4>
                              <p className="text-[10px] text-brand-primary/40 mt-1">Placeholders for manual PLM/ERP inputs.</p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Validation panel (shown only if errors exist) */}
                  {validationErrors.length > 0 && (
                    <div id="validation-panel" className="p-4 rounded-xl bg-brand-danger/10 border border-brand-danger/20 text-brand-danger text-xs space-y-2">
                      <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4" />
                        <span>Pre-Export Validation Blocked</span>
                      </div>
                      <ul className="list-disc pl-5 space-y-1">
                        {validationErrors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                      <p className="text-[10px] text-brand-danger/80">
                        Please adjust the Project Name inside the active workspace form to continue.
                      </p>
                    </div>
                  )}

                  {/* Matrix Preview Grid */}
                  <div className="bg-brand-surface rounded-2xl border border-brand-border overflow-hidden shadow-sm" id="matrix-preview-card">
                    <div className="p-6 border-b border-brand-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-semibold text-white flex items-center gap-1.5 font-display">
                          <Table className="h-4 w-4 text-brand-accent" />
                          Update Matrix Grid Preview
                        </h3>
                        <p className="text-xs text-brand-primary/60 mt-0.5">
                          Visual mapping of the flat output row columns. Cells display aligned multiline attributes.
                        </p>
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-brand-accent/20 border border-brand-accent/30"></span>
                          <span className="text-brand-primary/60">Source Verified</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-brand-warning/20 border border-brand-warning/30"></span>
                          <span className="text-brand-primary/60">Low Confidence</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-brand-bg border border-brand-border"></span>
                          <span className="text-brand-primary/60">Manual (Blank)</span>
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto" id="table-scroller">
                      <table className="w-full text-left border-collapse min-w-[2000px] text-xs">
                        <thead>
                          <tr className="bg-brand-bg border-b border-brand-border text-brand-primary font-medium">
                            <th className="p-3 font-mono sticky left-0 bg-brand-bg border-r border-brand-border z-10 w-48 text-center font-semibold">
                              Column Attribute
                            </th>
                            <th className="p-3 font-semibold">Cell Format / Output String Preview</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const exportRow = buildExportRow(selectedBuild);
                            const blankHeaders = [
                              "Gen", "Check code", "DCN/ECR-1", "DCN/ECR-2", "Build Date-1", 
                              "Build Date-2", "825* PN", "WO#-1", "WO#-2", "Build#"
                            ];

                            return EXPORT_HEADERS.map((colName, index) => {
                              let status: 'verified' | 'low' | 'blank' = 'verified';
                              let reason = "Populated from source headers";

                              if (blankHeaders.includes(colName)) {
                                status = 'blank';
                                reason = "Excluded from BOM parser - requires manual traveler input";
                              } else if (colName === "Stage") {
                                status = selectedBuild.stageConfidence === 'low' ? 'low' : 'verified';
                                reason = "Recovered tentatively from file tags";
                              } else if (colName === "FF") {
                                status = selectedBuild.ffConfidence === 'low' ? 'low' : 'verified';
                                reason = "Recovered tentatively from file tags";
                              } else if (colName === "Project") {
                                status = selectedBuild.projectConfidence === 'low' || !selectedBuild.projectName ? 'low' : 'verified';
                                reason = "Detected from filename prefix";
                              } else if (selectedBuild.mappedComponents[colName]) {
                                status = 'verified';
                                const mapped = selectedBuild.mappedComponents[colName]!;
                                reason = mapped.sourceRow.matchReason || "Aligned using designators";
                              } else if (exportRow[colName]) {
                                status = 'verified';
                                reason = "Mapped key-value parameter";
                              } else {
                                status = 'blank';
                                reason = "No matching row found in source BOM";
                              }

                              const cellValue = exportRow[colName];

                              return (
                                <tr key={colName} className="border-b border-brand-border/40 hover:bg-brand-bg/30 transition-colors">
                                  {/* Header column pinned to left */}
                                  <td className="p-3 font-mono font-medium text-brand-primary sticky left-0 bg-brand-surface border-r border-brand-border z-10">
                                    <div className="flex items-center justify-between">
                                      <span className="truncate max-w-[150px] font-semibold" title={colName}>{colName}</span>
                                      <span className="text-[10px] font-mono text-brand-primary/40">#{index + 1}</span>
                                    </div>
                                  </td>
                                  
                                  {/* Cell Content */}
                                  <td className="p-3">
                                    <div className="flex items-start gap-4">
                                      {editingColName === colName ? (
                                        <div className="flex-1 max-w-lg space-y-2">
                                          <textarea
                                            value={editValue}
                                            onChange={(e) => setEditValue(e.target.value)}
                                            rows={cellValue && cellValue.includes('\n') ? 4 : 2}
                                            className="w-full font-mono text-xs bg-brand-bg border border-brand-accent rounded-lg p-2.5 text-white focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
                                            placeholder="Enter cell value..."
                                          />
                                          <div className="flex items-center gap-2">
                                            <button
                                              onClick={() => handleCellOverride(colName, editValue)}
                                              className="px-2.5 py-1 text-[10px] font-semibold bg-brand-accent hover:bg-brand-accent-hover text-black rounded flex items-center gap-1 cursor-pointer"
                                            >
                                              Save
                                            </button>
                                            <button
                                              onClick={() => setEditingColName(null)}
                                              className="px-2.5 py-1 text-[10px] font-semibold bg-brand-surface hover:bg-brand-border border border-brand-border text-brand-primary rounded flex items-center gap-1 cursor-pointer"
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="flex-1 max-w-lg flex items-start gap-2 group">
                                          <div className={`p-3 rounded-lg font-mono text-xs flex-1 border relative ${
                                            selectedBuild.overrides && selectedBuild.overrides[colName] !== undefined
                                              ? "bg-brand-warning/10 border-brand-warning/30 text-brand-warning"
                                              : status === 'verified' 
                                              ? "bg-brand-accent/5 border-brand-accent/15 text-brand-accent"
                                              : status === 'low'
                                              ? "bg-brand-warning/5 border-brand-warning/15 text-brand-warning"
                                              : "bg-brand-bg border-brand-border text-brand-primary/40 italic"
                                          }`}>
                                            {selectedBuild.overrides && selectedBuild.overrides[colName] !== undefined && (
                                              <span className="absolute top-1.5 right-2 text-[8px] font-bold uppercase px-1 rounded bg-brand-warning/20 text-brand-warning tracking-wider">
                                                Edited
                                              </span>
                                            )}
                                            {cellValue ? (
                                              <pre className="whitespace-pre-wrap leading-relaxed">{cellValue}</pre>
                                            ) : (
                                              <span>[BLANK]</span>
                                            )}
                                          </div>
                                          
                                          <div className="flex flex-col gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                                            <button
                                              title="Edit cell value"
                                              onClick={() => {
                                                setEditingColName(colName);
                                                setEditValue(cellValue || "");
                                              }}
                                              className="p-1 rounded bg-brand-surface border border-brand-border hover:border-brand-accent hover:text-brand-accent transition-colors cursor-pointer"
                                            >
                                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                              </svg>
                                            </button>
                                            {selectedBuild.overrides && selectedBuild.overrides[colName] !== undefined && (
                                              <button
                                                title="Revert to auto-parsed value"
                                                onClick={() => handleCellRevert(colName)}
                                                className="p-1 rounded bg-brand-surface border border-brand-border hover:border-brand-danger hover:text-brand-danger transition-colors cursor-pointer"
                                              >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17" />
                                                </svg>
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      )}

                                      <div className="flex flex-col justify-center min-h-[50px] text-[11px] text-brand-primary/60 w-48">
                                        <span className="font-semibold text-brand-primary">
                                          {selectedBuild.overrides && selectedBuild.overrides[colName] !== undefined ? "OVERRIDDEN" : status.toUpperCase()}
                                        </span>
                                        <span className="text-brand-primary/40 mt-0.5">
                                          {selectedBuild.overrides && selectedBuild.overrides[colName] !== undefined ? "Manually edited before export" : reason}
                                        </span>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Complete Parsed BOM Table Trace Logs */}
                  <div className="bg-brand-surface rounded-2xl border border-brand-border p-6 space-y-4 shadow-sm" id="bom-raw-trace-card">
                    <div>
                      <h3 className="text-sm font-semibold text-white flex items-center gap-1.5 font-display">
                        <FileText className="h-4 w-4 text-brand-accent" />
                        Source BOM Trace Log
                      </h3>
                      <p className="text-xs text-brand-primary/60 mt-0.5">
                        Displays every parsed row in the source file, mapping indices, and raw cell values to trace conversion logic.
                      </p>
                    </div>

                    <div className="overflow-x-auto max-h-[300px] border border-brand-border rounded-xl" id="trace-table-scroller">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-brand-bg border-b border-brand-border text-brand-primary font-medium font-mono">
                            <th className="p-3">Description</th>
                            <th className="p-3">BOM Primary Part#</th>
                            <th className="p-3">Loc</th>
                            <th className="p-3">NPBR Qual Matrix Part#</th>
                            <th className="p-3">MFG</th>
                            <th className="p-3">MFG P/N</th>
                            <th className="p-3">SNDK Column Aligned</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedBuild.bomRows.map((row, idx) => (
                            <tr key={idx} className="border-b border-brand-border/40 hover:bg-brand-bg/20 font-mono text-[11px]">
                              <td className="p-3 text-brand-primary/95 max-w-xs truncate" title={row.description}>{row.description}</td>
                              <td className="p-3 text-brand-primary/60">{row.bomPrimaryPart || "-"}</td>
                              <td className="p-3 text-brand-primary">{row.loc || "-"}</td>
                              <td className="p-3 text-brand-primary/60">{row.npbrQualMatrixPart || "-"}</td>
                              <td className="p-3 text-brand-primary/60">{row.mfg2 || row.mfg1 || "-"}</td>
                              <td className="p-3 text-brand-primary/60">{row.mfgPn || row.mfgMfgPn || "-"}</td>
                              <td className="p-3">
                                {row.matchedColumn ? (
                                  <span className="px-2 py-0.5 rounded bg-brand-accent/10 text-brand-accent border border-brand-accent/20 text-[10px]">
                                    {row.matchedColumn}
                                  </span>
                                ) : (
                                  <span className="text-brand-primary/30">-</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-brand-primary/40 bg-brand-surface/25 border border-brand-border border-dashed rounded-2xl">
                  Select a build from the sidebar to inspect.
                </div>
              )}
            </div>

          </div>
        )}
      </main>

      {/* Rules and Mapping Help Modal */}
      {showHelpModal && (
        <div id="help-modal" className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-brand-surface border border-brand-border rounded-2xl max-w-3xl w-full p-6 space-y-6 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-brand-border">
              <h3 className="text-lg font-bold text-white flex items-center gap-2 font-display">
                <Layers className="h-5 w-5 text-brand-accent" />
                SNDK Build Matrix Mapping Specifications
              </h3>
              <button 
                id="close-help-btn"
                onClick={() => setShowHelpModal(false)}
                className="p-1 rounded-lg text-brand-primary/40 hover:text-white hover:bg-brand-bg transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-brand-primary/80 leading-relaxed">
              <div>
                <h4 className="text-sm font-semibold text-brand-accent mb-1.5 font-mono">Header Block Extraction Rules</h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Sandisk PN:</strong> Extracted directly from key-value <strong>SKU</strong>.</li>
                  <li><strong>9* PN:</strong> Extracted from key-value <strong>A198</strong>, prepended with <strong>9W0</strong> prefix.</li>
                  <li><strong>WD PN:</strong> Extracted from key-value <strong>A190</strong> (leading spaces automatically stripped).</li>
                  <li><strong>Qty-1 & Qty-2:</strong> Filled with <strong>Build Qty</strong>.</li>
                  <li><strong>Capacity:</strong> Mapped from the <strong>Capacity</strong> header cell.</li>
                  <li><strong>Remark:</strong> Extracted directly from Special Label / Remark for each Leg (if none present, left blank).</li>
                </ul>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-brand-accent mb-1.5 font-mono">Project Detection Rule (Strict)</h4>
                <p className="mb-1">
                  <strong>Project</strong> is set to <strong>"Carrera"</strong> or <strong>"Enzo"</strong> ONLY, based strictly on the source filename. If neither word appears, the project is left blank. Live forms allow validation before exporting.
                </p>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-brand-accent mb-1.5 font-mono">BGA column rule (Strict)</h4>
                <p>
                  BGA columns must strictly be labeled <strong>BGA</strong>, and are never labeled NAND. This is verified automatically prior to export.
                </p>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-brand-accent mb-1.5 font-mono">PCB Location Map Specifications</h4>
                <p className="mb-2">
                  Matches Loc designator strings (including sides like "TOP:" or "BOT:" and ranges) against BOM categories:
                </p>
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px] bg-brand-bg p-3 rounded-lg border border-brand-border">
                  <div>• PCB &rarr; "PCB" or "Printed Board"</div>
                  <div>• PMIC &rarr; Loc U121</div>
                  <div>• ASIC &rarr; Loc U1</div>
                  <div>• PLP+PMIC &rarr; Loc U123</div>
                  <div>• DRAM &rarr; Loc U10-U13, U20-U23</div>
                  <div>• BGA &rarr; Part A182- / Loc U100-103, 200-203</div>
                  <div>• SPI Flash &rarr; Loc U149</div>
                  <div>• Voltage Regulator &rarr; Loc U150</div>
                  <div>• LOAD SWITCH &rarr; Loc U151</div>
                  <div>• Crystal &rarr; Loc X1</div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-brand-accent mb-1.5 font-mono">Part Number Prefix Rules</h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>"9W0" prefix:</strong> Any part number starting with "A198".</li>
                  <li><strong>"7WD" prefix:</strong> Electronics components (ASIC, PMIC, PLP+PMIC, DRAM, BGA).</li>
                  <li><strong>"6W0" prefix:</strong> Mechanical/assembly components (Enclosure, Screw, Carton, TIM).</li>
                  <li><strong>"7W0" prefix:</strong> Any other components.</li>
                </ul>
              </div>

              <div className="p-3 bg-brand-accent/5 rounded-lg border border-brand-accent/15 text-brand-accent text-[11px]">
                Note: All cells that do not have any matching BOM row or headers remain fully blank inside the update CSV, ensuring zero guesswork is exported.
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-brand-border">
              <button
                id="close-help-footer-btn"
                onClick={() => setShowHelpModal(false)}
                className="px-4 py-2 bg-brand-accent hover:bg-brand-accent-hover text-black rounded-lg text-xs font-semibold transition-all cursor-pointer"
              >
                Close Reference
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Branding Line */}
      <footer className="border-t border-brand-border bg-brand-bg py-6 px-6 text-center text-xs text-brand-primary/40" id="app-footer-brand">
        <p>SNDK Build Matrix Mapper &copy; {new Date().getFullYear()}. Designed with precise Swiss standards.</p>
      </footer>
    </div>
  );
}
