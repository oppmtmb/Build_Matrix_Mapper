import Papa from "papaparse";

export interface BomRow {
  description: string;
  mfg1: string;
  bomPrimaryPart: string;
  mfgMfgPn: string;
  qtyPer: string;
  loc: string;
  npbrQualMatrixPart: string;
  mfg2: string;
  mfgPn: string;
  matchedColumn?: string;
  matchReason?: string;
}

export interface MappedCell {
  loc: string;
  partNumber: string;
  mfg: string;
  mfgPn: string;
  sourceRow: BomRow;
}

export interface ParsedBuild {
  id: string;
  filename: string;
  projectName: string; // 'Carrera' | 'Enzo' | ''
  stage: string;
  ff: string;
  capacity: string;
  sku: string;
  a198: string;
  a190: string;
  psSs: string;
  dwD: string;
  opPercent: string;
  soldAsCap: string;
  buildQty: string;
  specialInstructions: string[];
  legNum: string; // e.g. "Leg 1"
  remark: string;
  
  // Confidence flags
  stageConfidence: 'high' | 'low';
  ffConfidence: 'high' | 'low';
  projectConfidence: 'high' | 'low';
  
  // Data blocks
  bomRows: BomRow[];
  mappedComponents: Record<string, MappedCell | null>;
  overrides?: Record<string, string>;
}

export const EXPORT_HEADERS = [
  "Project", "Stage", "Gen", "FF", "Capacity", "Build#", "Leg#", "Check code",
  "DCN/ECR-1", "WO#-1", "Sandisk PN", "9* PN", "Qty-1", "Build Date-1", "Remark",
  "DCN/ECR-2", "WO#-2", "WD PN", "825* PN", "Qty-2", "Build Date-2", "PCB", "BGA",
  "DRAM", "ASIC", "LOAD SWITCH", "PLP+PMIC", "PLP+PMIC 2", "LDO-Voltage Regulator",
  "Voltage Regulator", "Voltage Detector", "E-Cap", "Aluminum Caps", "RFI Shield",
  "Polymer Cap-1", "Polymer Cap-2", "EEPROM", "Inductor-1", "Inductor-2", "Inductor-3",
  "Inductor-4", "Diode-1", "Diode-2", "Diode-3", "Diode-4", "Crystal", "SPI Flash",
  "Connector", "PMIC", "IC Translator", "IC Translator2", "MUX", "Temp Sensor",
  "TIM-1", "TIM-2", "TIM-3", "TIM-4", "Enclosures-1", "Enclosures-2", "Screw", "Carton",
  "REMARK"
];

/**
 * Parses individual designator strings, supporting sides (TOP:, BOT:) and ranges (U10-U13, U10-13)
 */
export function parseDesignators(locStr: string): string[] {
  if (!locStr) return [];
  // Split by commas, semicolons, or whitespace
  const rawTokens = locStr.split(/[\s,;]+/);
  const designators: string[] = [];

  for (let token of rawTokens) {
    token = token.trim();
    if (!token) continue;

    // Strip top/bot prefixes (e.g. TOP:U1 -> U1, BOT_SIDE:U12 -> U12)
    if (token.includes(':')) {
      const parts = token.split(':');
      token = parts[parts.length - 1].trim();
    }

    // Check for range like U10-U13 or U10-13
    const rangeMatch = token.match(/^([A-Za-z]+)(\d+)-([A-Za-z]*)(\d+)$/);
    if (rangeMatch) {
      const prefix1 = rangeMatch[1];
      const startNum = parseInt(rangeMatch[2], 10);
      const prefix2 = rangeMatch[3];
      const endNum = parseInt(rangeMatch[4], 10);
      const prefix = prefix2 || prefix1;

      if (!isNaN(startNum) && !isNaN(endNum) && startNum <= endNum) {
        // Prevent infinite loops if range is huge
        const limit = Math.min(endNum - startNum, 100);
        for (let i = 0; i <= limit; i++) {
          designators.push(`${prefix}${startNum + i}`);
        }
      } else {
        designators.push(token);
      }
    } else {
      designators.push(token);
    }
  }

  return designators;
}

/**
 * Removes location prefixes (like TOP:, BOT:, TOP_SIDE:, BOT_SIDE:, TOP :, BOT :) case-insensitively
 */
export function cleanLocationString(loc: string): string {
  if (!loc) return "";
  return loc.replace(/\b(?:TOP_SIDE|BOT_SIDE|TOP|BOT)\s*:\s*/gi, "").trim();
}

/**
 * Removes trailing comments, brackets, and spaces from part numbers (e.g. A190-012631-8192G(Qorvo PLP_PMIC) -> A190-012631-8192G)
 */
export function cleanPartNumber(part: string): string {
  if (!part) return "";
  let cleaned = part.trim();
  // Strip parentheses and anything inside them at the end
  cleaned = cleaned.replace(/\s*\(.*?\)\s*$/g, "");
  // Strip trailing/leading quotes
  cleaned = cleaned.replace(/^["']|["']$/g, "");
  return cleaned.trim();
}

/**
 * Formats capacity and rounds up any decimal capacities to their next integer value (e.g., 3.84TB -> 4TB)
 */
export function formatAndRoundCapacity(capacityStr: string): string {
  if (!capacityStr) return "";
  const cleaned = capacityStr.trim();
  
  // Match floating point or integer number, optional spaces, and units TB, GB, MB, PB
  const match = cleaned.match(/^([0-9.]+)\s*([a-zA-Z]+)$/);
  if (match) {
    const num = parseFloat(match[1]);
    const unit = match[2];
    if (!isNaN(num)) {
      const rounded = Math.ceil(num);
      return `${rounded}${unit.toUpperCase()}`;
    }
  }

  // Raw float without unit, e.g. "3.84"
  const rawNum = parseFloat(cleaned);
  if (!isNaN(rawNum) && /^[0-9.]+$/.test(cleaned)) {
    return String(Math.ceil(rawNum));
  }
  
  return cleaned;
}

/**
 * Standardizes part number prefix rules:
 * - "9W0" for parts starting with "A198"
 * - "7WD" for customer electronics (ASIC, PMIC, PMIC_PLP/PLP+PMIC, DRAM, BGA)
 * - "6W0" for mechanical assembly parts (Enclosure, Screw, Carton, TIM)
 * - "7W0" for everything else
 */
export function applyPartPrefix(partNum: string, componentType: string): string {
  const trimmed = partNum.trim();
  if (!trimmed) return "";

  // 1. Any part number starting with A198 gets 9W0
  if (trimmed.startsWith("A198")) {
    return `9W0${trimmed}`;
  }

  // 2. Component type rules
  const customerTypes = ["ASIC", "PMIC", "PLP+PMIC", "DRAM", "BGA"];
  const mechanicalTypes = ["Enclosures-1", "Enclosures-2", "Screw", "Carton", "TIM-1", "TIM-2", "TIM-3", "TIM-4"];

  if (customerTypes.includes(componentType)) {
    return `7WD${trimmed}`;
  } else if (mechanicalTypes.includes(componentType)) {
    return `6W0${trimmed}`;
  } else {
    return `7W0${trimmed}`;
  }
}

/**
 * Helper to clean a remark string value by stripping quotes, colons, leading/trailing punctuation
 */
function cleanRemarkValue(str: string): string {
  if (!str) return "";
  let s = str.trim();
  // Strip leading colons, semicolons, equals
  s = s.replace(/^[;:=]\s*/, "").trim();
  // Strip leading label headers if any
  s = s.replace(/^(special\s*label|special\s*instructions?|remarks?|notes?)\s*[:=]?\s*/gi, "").trim();
  // Strip leading Leg indicator (e.g. "Leg1:", "Leg 1:", "Leg1 -", "Leg2:", "L1:", "L2:")
  s = s.replace(/^(leg\s*[123]|l[123])\s*[:=\-]?\s*/gi, "").trim();
  // Strip trailing slashes, commas, semicolons, quotes
  s = s.replace(/[\s\/,;]+$/, "").trim();
  s = s.replace(/^["']|["']$/g, "").trim();
  return s;
}

/**
 * Extracts leg-specific remark segment from a string using regex pattern matching or line splitting.
 * e.g., "Special label:\nLeg1: TY 32T POC1 L1-P\nLeg2: TY 32T POC1 L2-S"
 * For legIndex=1 -> "TY 32T POC1 L1-P"
 * For legIndex=2 -> "TY 32T POC1 L2-S"
 */
function extractLegSegmentFromText(text: string, legIndex: number): string | null {
  if (!text) return null;

  // Split text into lines first (in case of multi-line text in merged cell)
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const targetKeywords = legIndex === 1
    ? ["leg1", "leg 1", "leg-1", "l1", "primary"]
    : ["leg2", "leg 2", "leg-2", "l2", "secondary", "leg3", "leg 3", "l3"];

  // 1. Search line by line
  for (const line of lines) {
    const lineLower = line.toLowerCase();
    const isTargetLine = targetKeywords.some(kw => {
      const reg = new RegExp(`\\b${kw.replace(" ", "\\s*")}\\b|${kw}:`, 'i');
      return reg.test(lineLower);
    });

    if (isTargetLine) {
      const cleaned = cleanRemarkValue(line);
      if (cleaned) return cleaned;
    }
  }

  // 2. Search whole text with regex spanning multiple legs on a single line
  // e.g. "Leg1: TY 32T POC1 L1-P, Leg2: TY 32T POC1 L2-S"
  // (?!\d) after the leg number stops "Leg 10", "Leg 11", "Leg 23" etc. from being
  // misread as "Leg 1"/"Leg 2" followed by a stray remark fragment ("0", "1", "3").
  const leg1Regex = /(?:leg\s*1(?!\d)|l1(?!\d)|primary)\s*[:=\-]?\s*(.*?)(?=(?:leg\s*[23](?!\d)|l[23](?!\d)|secondary|$))/is;
  const leg2Regex = /(?:leg\s*2(?!\d)|l2(?!\d)|secondary)\s*[:=\-]?\s*(.*?)(?=(?:leg\s*3(?!\d)|l3(?!\d)|$))/is;

  const targetRegex = legIndex === 1 ? leg1Regex : leg2Regex;
  const match = text.match(targetRegex);

  if (match && match[1]) {
    const cleaned = cleanRemarkValue(match[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

/**
 * Extracts the "Special label" or "Remark" text from the header block of the CSV sheet.
 * Leg 1 gets remark for Leg 1; Leg 2 gets remark for Leg 2.
 * If no special label or remark is present in the sheet, it returns "" (empty string).
 */
export function extractSpecialLabelOrRemark(headerBlockRows: string[][], legIndex: number): string {
  if (!headerBlockRows || headerBlockRows.length === 0) return "";

  // Pass 1: Scan every cell in the header block for explicit Leg 1 / Leg 2 label matches
  for (const row of headerBlockRows) {
    for (const cell of row) {
      if (!cell) continue;
      const legSegment = extractLegSegmentFromText(cell, legIndex);
      if (legSegment) {
        return legSegment;
      }
    }
  }

  // Pass 2: Scan for "Special label" or "Remark" header cell
  for (let r = 0; r < headerBlockRows.length; r++) {
    const row = headerBlockRows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = (row[c] || "").trim();
      if (!cell) continue;
      const cellLower = cell.toLowerCase();

      if (
        cellLower.includes("special label") ||
        cellLower.includes("speciallabel") ||
        cellLower.includes("special_label") ||
        cellLower === "remark" ||
        cellLower === "remarks" ||
        cellLower.startsWith("remark:")
      ) {
        // Option A: Check subsequent cells in the SAME row (e.g. Col B for Leg 1, Col C for Leg 2)
        const subsequentVals: string[] = [];
        for (let nextC = c + 1; nextC < row.length; nextC++) {
          const nextCell = (row[nextC] || "").trim();
          if (nextCell && nextCell !== ":" && nextCell !== "=") {
            const val = cleanRemarkValue(nextCell);
            if (val) subsequentVals.push(val);
          }
        }

        if (subsequentVals.length > 0) {
          const chosen = subsequentVals[legIndex - 1] || subsequentVals[0];
          if (chosen) return chosen;
        }

        // Option B: Check subsequent rows directly below "Special label:" header row
        const nonPassHeaderRowsBelow: string[] = [];
        for (let nextR = r + 1; nextR < headerBlockRows.length; nextR++) {
          const rText = headerBlockRows[nextR].map(cell => cell.trim()).filter(Boolean).join(" ");
          if (rText) {
            // Check if this row below has explicit Leg indicator
            const legSeg = extractLegSegmentFromText(rText, legIndex);
            if (legSeg) return legSeg;

            nonPassHeaderRowsBelow.push(rText);
          }
        }

        // If rows below don't have explicit "Leg 1 / Leg 2" prefixes, use the N-th row below (N = legIndex)
        if (nonPassHeaderRowsBelow.length >= legIndex) {
          const targetRowText = nonPassHeaderRowsBelow[legIndex - 1];
          const cleaned = cleanRemarkValue(targetRowText);
          if (cleaned) return cleaned;
        } else if (nonPassHeaderRowsBelow.length > 0) {
          const cleaned = cleanRemarkValue(nonPassHeaderRowsBelow[0]);
          if (cleaned && legIndex === 1) return cleaned;
        }
      }
    }
  }

  // If no Special Label or Remark is found, return empty string
  return "";
}

/**
 * Parses a Line Validation Build Matrix BOM CSV
 */
/**
 * Counts how many leg columns a sheet actually has, by counting the duplicated
 * "NPBR Qual Matrix Part#" header cells in the BOM header row (one per leg).
 * This replaces the old text-search ("does the file contain the words 'leg 2'
 * or 'leg 3'?") which silently dropped legs whenever a sheet's legs were
 * numbered outside 1-3 (e.g. "Leg 4".."Leg 7").
 */
export function detectLegCount(csvText: string): number {
  const parsed = Papa.parse<string[]>(csvText, { header: false, skipEmptyLines: false });
  const rows = parsed.data;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map(c => (c || "").trim().toLowerCase());
    const hasDescription = row.some(cell => cell.includes("description"));
    const hasLoc = row.some(cell => cell.includes("loc") || cell.includes("designator"));
    const hasPrimaryPart = row.some(cell => cell.includes("bom primary part") || cell.includes("primary part#") || cell.includes("part#"));
    const hasQualPart = row.some(cell => cell.includes("npbr qual") || cell.includes("qual matrix"));

    if (hasDescription && (hasLoc || hasPrimaryPart || hasQualPart)) {
      const qualCount = row.filter(cell => cell.includes("npbr qual") || cell.includes("qual matrix")).length;
      return Math.max(qualCount, 1);
    }
  }
  return 1;
}

/**
 * Finds the row in the header block that lists each leg's label (e.g.
 * "Leg 1", "Leg 2", "Leg 3" ... "Leg 11") and returns those labels in
 * left-to-right order. Falls back to positional "Leg N" naming if no such
 * row is found (or if a given leg has no explicit label).
 */
export function detectLegLabels(csvText: string): string[] {
  const parsed = Papa.parse<string[]>(csvText, { header: false, skipEmptyLines: false });
  const rows = parsed.data;

  let bestRow: string[] = [];
  for (const row of rows) {
    const legCells = row.filter(cell => /^leg\s*\d+$/i.test((cell || "").trim()));
    if (legCells.length > bestRow.length) {
      bestRow = legCells.map(c => c.trim().replace(/\s+/g, " "));
    }
  }
  return bestRow;
}

export function parseLVBuildMatrix(csvText: string, filename: string, legIndex: number = 1): ParsedBuild {
  const parsed = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: false,
  });

  const rows = parsed.data;

  // 1. Locate the BOM Table Header Row
  // It contains "Description", "BOM Primary Part#", "Loc", "NPBR Qual Matrix Part#"
  let bomHeaderIndex = -1;
  let headers: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map(c => c.trim().toLowerCase());
    const hasDescription = row.some(cell => cell.includes("description"));
    const hasLoc = row.some(cell => cell.includes("loc") || cell.includes("designator"));
    const hasPrimaryPart = row.some(cell => cell.includes("bom primary part") || cell.includes("primary part#") || cell.includes("part#"));
    const hasQualPart = row.some(cell => cell.includes("npbr qual") || cell.includes("qual matrix"));

    if (hasDescription && (hasLoc || hasPrimaryPart || hasQualPart)) {
      bomHeaderIndex = i;
      headers = rows[i].map(c => c.trim());
      break;
    }
  }

  // Fallback if header not explicitly found
  if (bomHeaderIndex === -1) {
    // Search for first row with more than 5 elements that looks like headers
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].length >= 5 && rows[i].some(c => c.toLowerCase().trim() === "description")) {
        bomHeaderIndex = i;
        headers = rows[i].map(c => c.trim());
        break;
      }
    }
  }

  const headerBlockRows = bomHeaderIndex !== -1 ? rows.slice(0, bomHeaderIndex) : [];
  const bomDataRows = bomHeaderIndex !== -1 ? rows.slice(bomHeaderIndex + 1) : rows;

  // 2. Parse Header Block
  const headerMap: Record<string, string> = {
    sku: "",
    a198: "",
    a190: "",
    "ps/ss": "",
    "dw/d": "",
    "%op": "",
    "sold as cap": "",
    "build qty": "",
    capacity: ""
  };
  const specialInstructions: string[] = [];

  // Helper function to check if a row contains any of the target keywords and extract its corresponding value (legIndex-aware)
  const extractValue = (
    row: string[],
    matcher: (cellLower: string) => boolean,
    excludeMatcher?: (cellLower: string) => boolean
  ): string | null => {
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const cell = (row[colIdx] || "").trim();
      if (!cell) continue;
      const cellLower = cell.toLowerCase();

      if (matcher(cellLower)) {
        if (excludeMatcher && excludeMatcher(cellLower)) {
          continue;
        }

        // Option A: cell itself contains a colon with a value, e.g. "SKU: Carrera-16TB"
        if (cell.includes(":")) {
          const parts = cell.split(":");
          const val = parts.slice(1).join(":").trim();
          if (val) return val;
        }

        // Option B: value is in subsequent cell(s) in this row.
        // We want the L-th non-empty cell where L = legIndex.
        let nonEmptiesFound = 0;
        for (let nextIdx = colIdx + 1; nextIdx < row.length; nextIdx++) {
          const nextCell = (row[nextIdx] || "").trim();
          if (nextCell !== "") {
            // Skip separators
            if (nextCell === ":" || nextCell === "=") continue;
            if (nextCell.startsWith(":") || nextCell.startsWith("=")) {
              const cleared = nextCell.substring(1).trim();
              if (cleared) {
                nonEmptiesFound++;
                if (nonEmptiesFound === legIndex) {
                  return cleared;
                }
              }
              continue;
            }
            nonEmptiesFound++;
            if (nonEmptiesFound === legIndex) {
              return nextCell;
            }
          }
        }
        
        // Fallback: if we wanted legIndex 2 but only 1 value exists, fallback to the 1st value
        if (nonEmptiesFound > 0) {
          for (let nextIdx = colIdx + 1; nextIdx < row.length; nextIdx++) {
            const nextCell = (row[nextIdx] || "").trim();
            if (nextCell !== "" && nextCell !== ":" && nextCell !== "=") {
              if (nextCell.startsWith(":") || nextCell.startsWith("=")) {
                const cleared = nextCell.substring(1).trim();
                if (cleared) return cleared;
              } else {
                return nextCell;
              }
            }
          }
        }

        // Option C: If no subsequent non-empty cells were found, but the matched cell itself is a valid value, return it!
        if (cell.startsWith("A198") || cell.startsWith("A190") || cell.startsWith("9W0") || /^[0-9.]+\s*(?:tb|gb)/i.test(cell)) {
          return cell;
        }
      }
    }
    return null;
  };

  for (const row of headerBlockRows) {
    const nonEmpties = row.filter(cell => (cell || "").trim() !== "");
    if (nonEmpties.length === 0) continue;

    let isAnyHeaderMatched = false;

    // Check SKU (Sandisk PN)
    const skuVal = extractValue(
      row,
      (c) => c.includes("sku") || c.includes("sandisk") || c.includes("sd pn") || c.includes("sd part")
    );
    if (skuVal && !headerMap["sku"]) {
      headerMap["sku"] = skuVal;
      isAnyHeaderMatched = true;
    }

    // Check A198 (9* PN)
    const a198Val = extractValue(
      row,
      (c) => c.includes("a198") || 
             /9[w0-9][0-9]\s*(?:p\/n|pn|part|number|#)/.test(c) ||
             c.includes("9w0") || 
             c.includes("900") || 
             c.includes("903") || 
             c.includes("9*")
    );
    if (a198Val && !headerMap["a198"]) {
      headerMap["a198"] = a198Val;
      isAnyHeaderMatched = true;
    }

    // Direct scan for cell values that look like a 9W0 / 900 / A198 part number
    let foundDirectA198 = "";
    let a198Matches: string[] = [];
    for (const cell of row) {
      const trimmedCell = (cell || "").trim();
      if (/^9[W0-9][0-9]-\d{5}/i.test(trimmedCell) || /^9[W0-9][0-9]-[A-Z0-9-]{5,}/i.test(trimmedCell) || /^A198-\d{5,}/i.test(trimmedCell)) {
        a198Matches.push(trimmedCell);
      }
    }
    if (a198Matches.length > 0) {
      foundDirectA198 = a198Matches[legIndex - 1] || a198Matches[0];
    }
    if (foundDirectA198 && !headerMap["a198"]) {
      headerMap["a198"] = foundDirectA198;
      isAnyHeaderMatched = true;
    }

    // Check A190 (WD PN)
    const a190Val = extractValue(
      row,
      (c) => c.includes("a190") || c.includes("wd pn") || c.includes("wd p/n") || c.includes("wd part") || c.includes("wdpn") || c.includes("wd_pn") || c.includes("wd sku") || c.startsWith("54-")
    );
    if (a190Val && !headerMap["a190"]) {
      headerMap["a190"] = a190Val;
      isAnyHeaderMatched = true;
    }

    // Direct scan for cell values that look like a 54- or A190 part number
    let foundDirectA190 = "";
    let a190Matches: string[] = [];
    for (const cell of row) {
      const trimmedCell = (cell || "").trim();
      if (/^A190-\d{5,}/i.test(trimmedCell) || /^54-\d{5,}/i.test(trimmedCell)) {
        a190Matches.push(trimmedCell);
      }
    }
    if (a190Matches.length > 0) {
      foundDirectA190 = a190Matches[legIndex - 1] || a190Matches[0];
    }
    if (foundDirectA190 && !headerMap["a190"]) {
      headerMap["a190"] = foundDirectA190;
      isAnyHeaderMatched = true;
    }

    // Check Build Qty
    const buildQtyVal = extractValue(
      row,
      (c) => c.includes("build qty") || 
             c.includes("build quantity") || 
             c.includes("build q'ty") || 
             c.includes("build q`ty") || 
             c.includes("build_qty") || 
             c.includes("qty") || 
             c.includes("quantity") || 
             c.includes("build count") ||
             c.includes("buildqty")
    );
    if (buildQtyVal && !headerMap["build qty"]) {
      headerMap["build qty"] = buildQtyVal;
      isAnyHeaderMatched = true;
    }

    // Check Capacity
    const capacityVal = extractValue(
      row,
      (c) => {
        const normalized = c.replace(/[:\s]/g, ""); // strip colons and spaces
        if (normalized.includes("capacitor") || normalized.includes("soldas")) return false;
        
        // Exclude polymer/tantalum/aluminum etc.
        const excludes = ["polymer", "aluminum", "ceramic", "tantalum", "decoupling", "bypass", "ecap", "filter", "resistor", "inductor", "diode", "screw", "carton", "connector"];
        if (excludes.some(ex => normalized.includes(ex))) return false;

        return normalized === "cap" || 
               normalized.includes("capacity") || 
               normalized.includes("drivecap") || 
               normalized.includes("ssdcap") ||
               normalized.includes("drivecapacity") ||
               normalized === "drivesize" ||
               normalized === "size";
      }
    );
    if (capacityVal && !headerMap["capacity"]) {
      headerMap["capacity"] = capacityVal;
      isAnyHeaderMatched = true;
    }

    // Direct scan for cell values that look like drive capacities
    let foundDirectCapacity = "";
    let capacityMatches: string[] = [];
    for (const cell of row) {
      const trimmedCell = (cell || "").trim();
      const cellLower = trimmedCell.toLowerCase();
      // Exclude capacitor terms
      if (cellLower.includes("capacitor") || cellLower.includes("cap-") || cellLower.includes("pf") || cellLower.includes("uf") || cellLower.includes("nf")) {
        continue;
      }
      if (/^[0-9.]+\s*(?:tb|gb|mb|pb)$/i.test(trimmedCell)) {
        capacityMatches.push(trimmedCell);
      }
    }
    if (capacityMatches.length > 0) {
      foundDirectCapacity = capacityMatches[legIndex - 1] || capacityMatches[0];
    }
    if (foundDirectCapacity && !headerMap["capacity"]) {
      headerMap["capacity"] = foundDirectCapacity;
      isAnyHeaderMatched = true;
    }

    // Check PS/SS (Build Side)
    const psSsVal = extractValue(
      row,
      (c) => c.includes("ps/ss") || c.includes("ps-ss") || c.includes("ps_ss") || c.includes("build side") || c.includes("side")
    );
    if (psSsVal && !headerMap["ps/ss"]) {
      headerMap["ps/ss"] = psSsVal;
      isAnyHeaderMatched = true;
    }

    // Check DW/D (Dual Write Mode)
    const dwDVal = extractValue(
      row,
      (c) => c.includes("dw/d") || c.includes("dw-d") || c.includes("dw_d") || c.includes("write mode") || c.includes("dual write") || c.includes("mode")
    );
    if (dwDVal && !headerMap["dw/d"]) {
      headerMap["dw/d"] = dwDVal;
      isAnyHeaderMatched = true;
    }

    // Check %OP (Overprovisioning)
    const opVal = extractValue(
      row,
      (c) => c.includes("%op") || c.includes("overprovision") || c.includes("op %") || c.includes("op%") || c.includes("over-provision")
    );
    if (opVal && !headerMap["%op"]) {
      headerMap["%op"] = opVal;
      isAnyHeaderMatched = true;
    }

    // Check Sold as Cap
    const soldAsCapVal = extractValue(
      row,
      (c) => c.includes("sold as cap") || c.includes("sold_as_cap") || c.includes("soldascap") || c.includes("sold as")
    );
    if (soldAsCapVal && !headerMap["sold as cap"]) {
      headerMap["sold as cap"] = soldAsCapVal;
      isAnyHeaderMatched = true;
    }

    if (!isAnyHeaderMatched) {
      // Add to free-text special instructions
      const line = row.join(" ").trim();
      if (line && !line.toLowerCase().includes("special instructions:") && !line.toLowerCase().includes("instruction:")) {
        specialInstructions.push(line);
      } else if (line) {
        // Strip the label
        const stripped = line.replace(/^(special\s+)?instructions?:\s*/i, "").trim();
        if (stripped) {
          specialInstructions.push(stripped);
        }
      }
    }
  }

  // 3. Resolve Header-Block Field Values
  const sku = cleanPartNumber(headerMap["sku"] || "");
  const a198 = cleanPartNumber(headerMap["a198"] || "");
  const a190 = cleanPartNumber(headerMap["a190"] || "");
  const psSs = (headerMap["ps/ss"] || "").trim().replace(/^["']|["']$/g, "").trim();
  const dwD = (headerMap["dw/d"] || "").trim().replace(/^["']|["']$/g, "").trim();
  const opPercent = (headerMap["%op"] || "").trim().replace(/^["']|["']$/g, "").trim();
  const soldAsCap = (headerMap["sold as cap"] || "").trim().replace(/^["']|["']$/g, "").trim();
  const buildQty = (headerMap["build qty"] || "").trim().replace(/^["']|["']$/g, "").trim();
  const capacityRaw = (headerMap["capacity"] || headerMap["sold as cap"] || "").trim().replace(/^["']|["']$/g, "").trim();
  const capacity = formatAndRoundCapacity(capacityRaw);

  // 4. Project Name Detection (Filename / Sheet name / Header text)
  let projectName = "";
  const lowerFilename = filename.toLowerCase();
  const lowerCsv = csvText.toLowerCase();
  if (lowerFilename.includes("carrera") || lowerCsv.includes("carrera")) {
    projectName = "Carrera";
  } else if (lowerFilename.includes("enzo") || lowerCsv.includes("enzo")) {
    projectName = "Enzo";
  }

  // 5. Stage & FF Detection (Partially from filename / special instructions)
  const specInstJoined = specialInstructions.join(" ");
  
  let stage = "";
  let stageConfidence: 'high' | 'low' = 'low';
  const stageKeywords = ["EVT", "DVT", "PVT", "MP", "Proto"];
  for (const s of stageKeywords) {
    const regex = new RegExp(`\\b${s}\\b`, 'i');
    if (regex.test(filename) || regex.test(specInstJoined)) {
      stage = s;
      break;
    }
  }

  let ff = "";
  let ffConfidence: 'high' | 'low' = 'low';
  const ffKeywords = ["U.2", "M.2", "E1.S", "E3.S", "AIC", "U.3"];
  for (const f of ffKeywords) {
    const regex = new RegExp(f.replace(".", "\\."), 'i');
    if (regex.test(filename) || regex.test(specInstJoined)) {
      ff = f;
      break;
    }
  }

  // 6. Remark construction
  const remark = extractSpecialLabelOrRemark(headerBlockRows, legIndex);
  const detectedLegLabels = detectLegLabels(csvText);
  const legNum = detectedLegLabels[legIndex - 1] || `Leg ${legIndex}`;

  // 7. Parse BOM Rows
  // Map out Column Indices from the headers array
  const colIndex = (keyword: string, fallback: number): number => {
    const idx = headers.findIndex(h => h.toLowerCase().includes(keyword.toLowerCase()));
    return idx !== -1 ? idx : fallback;
  };

  // Find occurrences of MFG (there are typically two)
  const mfgIndices: number[] = [];
  headers.forEach((h, idx) => {
    if (h.toLowerCase() === "mfg") {
      mfgIndices.push(idx);
    }
  });

  const descIdx = colIndex("description", 0);
  const mfg1Idx = mfgIndices[0] !== undefined ? mfgIndices[0] : 1;
  const primaryPartIdx = colIndex("bom primary part", 2);
  const mfgPnIdx = colIndex("mfg/mfg pn", 3);
  const qtyIdx = colIndex("qty per", 4);
  const locIdx = colIndex("loc", 5);

  // There is one "NPBR Qual Matrix Part#" column PER LEG (duplicate header text).
  // Picking only the first occurrence (old behavior) made every leg reuse leg 1's
  // component data. Collect every occurrence and pick the one matching this leg.
  const qualPartIndices = headers
    .map((h, idx) => ({ h: h.toLowerCase(), idx }))
    .filter(({ h }) => h.includes("npbr qual") || h.includes("qual matrix"))
    .map(({ idx }) => idx);
  const qualPartIdx = qualPartIndices.length > 0
    ? (qualPartIndices[legIndex - 1] !== undefined
        ? qualPartIndices[legIndex - 1]
        : qualPartIndices[qualPartIndices.length - 1])
    : 6;
  
  // Find MFG P/N (the last column usually)
  let mfgPartNoIdx = headers.findIndex(h => h.toLowerCase() === "mfg p/n" || h.toLowerCase() === "mfg pn");
  if (mfgPartNoIdx === -1) mfgPartNoIdx = headers.length - 1;

  // Find MFG and MFG P/N column indices based on legIndex
  let mfgLegIdx = -1;
  let mfgPnLegIdx = -1;

  if (legIndex === 1) {
    mfgLegIdx = headers.findIndex(h => {
      const lower = h.toLowerCase();
      return lower.includes("mfg") && (lower.includes("leg 1") || lower.includes("leg1") || lower.includes("primary") || lower.includes("first"));
    });
    mfgPnLegIdx = headers.findIndex(h => {
      const lower = h.toLowerCase();
      return lower.includes("mfg") && (lower.includes("pn") || lower.includes("p/n")) && (lower.includes("leg 1") || lower.includes("leg1") || lower.includes("primary") || lower.includes("first"));
    });
  } else if (legIndex === 2) {
    mfgLegIdx = headers.findIndex(h => {
      const lower = h.toLowerCase();
      return lower.includes("mfg") && (lower.includes("leg 2") || lower.includes("leg2") || lower.includes("leg 3") || lower.includes("leg3") || lower.includes("second") || lower.includes("2nd"));
    });
    mfgPnLegIdx = headers.findIndex(h => {
      const lower = h.toLowerCase();
      return lower.includes("mfg") && (lower.includes("pn") || lower.includes("p/n")) && (lower.includes("leg 2") || lower.includes("leg2") || lower.includes("leg 3") || lower.includes("leg3") || lower.includes("second") || lower.includes("2nd"));
    });
  }

  // Fallback to standard columns if not found
  if (mfgLegIdx === -1) {
    mfgLegIdx = mfgIndices[1] !== undefined ? mfgIndices[1] : (mfgIndices[0] !== undefined ? mfgIndices[0] : 7);
  }
  if (mfgPnLegIdx === -1) {
    mfgPnLegIdx = headers.findIndex((h, idx) => {
      const lower = h.toLowerCase();
      return idx > mfgLegIdx && (lower.includes("p/n") || lower.includes("pn") || lower.includes("part"));
    });
    if (mfgPnLegIdx === -1) mfgPnLegIdx = mfgPartNoIdx;
  }

  const bomRows: BomRow[] = [];

  for (const row of bomDataRows) {
    if (row.length < 2) continue; // Skip empty row or lines with no cells
    const description = row[descIdx] || "";
    if (!description || description.trim() === "") continue; // Skip rows with blank description

    bomRows.push({
      description: description.trim(),
      mfg1: row[mfg1Idx] || "",
      bomPrimaryPart: row[primaryPartIdx] || "",
      mfgMfgPn: row[mfgPnIdx] || "",
      qtyPer: row[qtyIdx] || "",
      loc: cleanLocationString(row[locIdx] || ""),
      npbrQualMatrixPart: row[qualPartIdx] || "",
      mfg2: row[mfgLegIdx] || "",
      mfgPn: row[mfgPnLegIdx] || "",
    });
  }

  // 8. Match BOM Rows to Column Categories
  const mappedComponents: Record<string, MappedCell | null> = {};
  EXPORT_HEADERS.forEach(h => {
    mappedComponents[h] = null;
  });

  // Track matched indices so we don't double-match a row (except for multi-slot ones which are queued)
  const matchedIndices = new Set<number>();
  
  const plpPmicsMatched: BomRow[] = [];
  const polymerCapsMatched: BomRow[] = [];
  const inductorsMatched: BomRow[] = [];
  const diodesMatched: BomRow[] = [];
  const translatorsMatched: BomRow[] = [];
  const timsMatched: BomRow[] = [];
  const enclosuresMatched: BomRow[] = [];

  // The row's own PS/SS field tells us directly whether THIS leg is a
  // Primary-source build or a 2nd-Source build - this is the authoritative
  // signal for which vendor column applies, more reliable than trying to
  // sniff a vendor name out of the qual-matrix part text (many components,
  // e.g. Temp Sensor, carry no such embedded vendor annotation at all).
  const psSsLower = psSs.toLowerCase();
  const legIsPrimarySource = /primary/.test(psSsLower) && !/2nd|second/.test(psSsLower);
  const legIsSecondSource = /2nd|second/.test(psSsLower);

  // Choose which MFG / MFG P/N belongs to a given BOM row.
  //
  // The "MFG" / "MFG Part Number" columns at the end of the BOM header block
  // hold only ONE vendor+part pair (columns J/K), while the BOM Primary
  // Part# section (columns B/D) holds another. A row's actual vendor
  // differs per leg role: Primary-source legs use the B/D vendor, 2nd-Source
  // legs use the J/K vendor (or vice versa isn't assumed - we key off the
  // leg's own PS/SS role). The old code always took J/K for every leg,
  // which is why e.g. Temp Sensor showed "NXP" even for Primary-source legs
  // that should show "TI".
  const resolveMfgForRow = (row: BomRow): { mfg: string; mfgPn: string } => {
    const mfg1 = (row.mfg1 || "").trim();
    const mfg2 = (row.mfg2 || "").trim();
    const mfgPn1 = (row.mfgMfgPn || "").trim();
    const mfgPn2 = (row.mfgPn || "").trim();

    // Not just the vendor NAME can differ between the two columns - the same
    // vendor can supply a different part number per role too (e.g. Enclosures:
    // both columns say "Synactic", but Primary uses "M034-003329-S" while
    // 2nd Source uses "M034-003329-EN-S"). Route on role whenever EITHER the
    // vendor or the part number disagrees, not just the vendor name.
    const mfgDiffers = !!mfg1 && !!mfg2 && mfg1.toLowerCase() !== mfg2.toLowerCase();
    const mfgPnDiffers = !!mfgPn1 && !!mfgPn2 && mfgPn1.toLowerCase() !== mfgPn2.toLowerCase();
    const vendorsDiffer = mfgDiffers || mfgPnDiffers;

    if (vendorsDiffer) {
      if (legIsPrimarySource) return { mfg: mfg1, mfgPn: mfgPn1 || mfgPn2 };
      if (legIsSecondSource) return { mfg: mfg2, mfgPn: mfgPn2 || mfgPn1 };
    }

    // Role unknown for this leg (blank/unrecognized PS/SS), or the two
    // vendor columns already agree - try matching the vendor name embedded
    // in the qual/primary part text, e.g. "...(Gultech)", as a fallback.
    const qualText = (row.npbrQualMatrixPart || row.bomPrimaryPart || "").trim();
    const vendorMatch = qualText.match(/\(([^)]+)\)\s*$/);
    const embeddedVendor = vendorMatch ? vendorMatch[1].trim() : "";

    if (embeddedVendor) {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const ev = norm(embeddedVendor);
      if (mfg1 && ev && (norm(mfg1) === ev || ev.includes(norm(mfg1)) || norm(mfg1).includes(ev))) {
        return { mfg: mfg1, mfgPn: mfgPn1 || mfgPn2 };
      }
      if (mfg2 && ev && (norm(mfg2) === ev || ev.includes(norm(mfg2)) || norm(mfg2).includes(ev))) {
        return { mfg: mfg2, mfgPn: mfgPn2 || mfgPn1 };
      }
      // A vendor is explicitly named in the source but matches neither known
      // MFG column - don't guess which part number belongs to it.
      return { mfg: "", mfgPn: "" };
    }

    // No role, no embedded vendor annotation - trailing column first, then
    // primary (safe when B/D and J/K already agree, the common case).
    return { mfg: mfg2 || mfg1, mfgPn: mfgPn2 || mfgPn1 };
  };

  // Helper to register match
  const setMatch = (colName: string, row: BomRow, index: number, reason: string) => {
    row.matchedColumn = colName;
    row.matchReason = reason;
    matchedIndices.add(index);
    
    // Choose which MFG and MFG P/N to write
    const { mfg: finalMfg, mfgPn: finalMfgPn } = resolveMfgForRow(row);

    // NPBR Qual Matrix Part# is primary, with fallback to BOM Primary Part# if blank
    const sourcePart = row.npbrQualMatrixPart.trim() || row.bomPrimaryPart.trim();
    const prefixedPart = applyPartPrefix(sourcePart, colName);

    mappedComponents[colName] = {
      loc: row.loc, // Already cleaned inside bomRows loading loop
      partNumber: prefixedPart,
      mfg: finalMfg,
      mfgPn: finalMfgPn,
      sourceRow: row,
    };
  };

  bomRows.forEach((row, idx) => {
    const descLower = row.description.toLowerCase();
    const partLower = row.npbrQualMatrixPart.toLowerCase() || row.bomPrimaryPart.toLowerCase();
    const desigs = parseDesignators(row.loc);

    // 1. PCB
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("pcb") || descLower.includes("printed circuit board") || descLower.includes("printed wiring board") || descLower.includes("printed board")) {
        setMatch("PCB", row, idx, "Description contains 'PCB' / 'Printed Circuit Board'");
        return;
      }
    }

    // 2. ASIC (Loc U1)
    if (!matchedIndices.has(idx)) {
      if ((desigs.includes("U1") || desigs.includes("U1000")) && (descLower.includes("asic") || descLower.includes("controller") || descLower.includes("soc") || descLower.includes("processor") || descLower.includes("gate array"))) {
        setMatch("ASIC", row, idx, "Description contains ASIC/controller and Loc matches U1");
        return;
      }
    }

    // 3. PMIC (Loc U121)
    if (!matchedIndices.has(idx)) {
      if (desigs.includes("U121") && descLower.includes("pmic")) {
        setMatch("PMIC", row, idx, "Description contains PMIC and Loc matches U121");
        return;
      }
    }

    // 4. PLP+PMIC (PLP+PMIC, Loc U123 or U124 or PLP)
    if (!matchedIndices.has(idx)) {
      if (desigs.includes("U123") || desigs.includes("U124") || descLower.includes("plp") || (descLower.includes("pmic") && descLower.includes("plp"))) {
        plpPmicsMatched.push(row);
        matchedIndices.add(idx);
        return;
      }
    }

    // 5. SPI Flash (NOR FLASH MEMORY, Loc U149)
    if (!matchedIndices.has(idx)) {
      if (desigs.includes("U149") && (descLower.includes("nor") || descLower.includes("flash") || descLower.includes("spi") || descLower.includes("memory"))) {
        setMatch("SPI Flash", row, idx, "Description matches SPI/NOR Flash and Loc matches U149");
        return;
      }
    }

    // 6. Voltage Regulator (VOLTAGE REGULATOR, Loc U150)
    if (!matchedIndices.has(idx)) {
      if (desigs.includes("U150") && (descLower.includes("regulator") || descLower.includes("voltage") || descLower.includes("buck"))) {
        setMatch("Voltage Regulator", row, idx, "Description matches Regulator and Loc matches U150");
        return;
      }
    }

    // 7. LOAD SWITCH (LOAD SWITCH, Loc U151)
    if (!matchedIndices.has(idx)) {
      if (desigs.includes("U151") && (descLower.includes("load switch") || descLower.includes("switch"))) {
        setMatch("LOAD SWITCH", row, idx, "Description matches Load Switch and Loc matches U151");
        return;
      }
    }

    // 8. Crystal (CRYSTAL, Loc X1)
    if (!matchedIndices.has(idx)) {
      if ((desigs.includes("X1") || desigs.some(d => d.startsWith("X") || d.startsWith("Y"))) && (descLower.includes("crystal") || descLower.includes("xtal") || descLower.includes("oscillator"))) {
        setMatch("Crystal", row, idx, "Description matches Crystal/Oscillator and Loc matches X1/X/Y");
        return;
      }
    }

    // 9. DRAM (DDR/DRAM part, Loc U10-U13, U20-U23)
    if (!matchedIndices.has(idx)) {
      const dramLocs = ["U10", "U11", "U12", "U13", "U20", "U21", "U22", "U23"];
      const hasDramLoc = desigs.some(d => dramLocs.includes(d));
      const hasDramDesc = descLower.includes("dram") || descLower.includes("ddr") || descLower.includes("sdram") || descLower.includes("lpddr");
      if (hasDramLoc || (hasDramDesc && desigs.length > 0)) {
        setMatch("DRAM", row, idx, `DRAM component with reference designator in ${row.loc}`);
        return;
      }
    }

    // 10. BGA (BGA memory package, e.g. starts A182-, Loc U100-U103, U200-U203)
    if (!matchedIndices.has(idx)) {
      const bgaLocs = ["U100", "U101", "U102", "U103", "U200", "U201", "U202", "U203"];
      const hasBgaLoc = desigs.some(d => bgaLocs.includes(d));
      const startsWithA182 = partLower.startsWith("a182-");
      const hasBgaDesc = descLower.includes("bga") || descLower.includes("nand") || descLower.includes("flash") || descLower.includes("memory");
      if (startsWithA182 || hasBgaLoc || (hasBgaDesc && desigs.some(d => d.startsWith("U10") || d.startsWith("U20")))) {
        setMatch("BGA", row, idx, `BGA NAND Flash memory component at Loc ${row.loc}`);
        return;
      }
    }

    // 11. Enclosures (Typically 2 rows)
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("enclosure") || descLower.includes("case") || descLower.includes("housing") || descLower.includes("cover") || descLower.includes("bracket")) {
        enclosuresMatched.push(row);
        matchedIndices.add(idx);
        return;
      }
    }

    // 12. LDO-Voltage Regulator
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("ldo") || descLower.includes("linear regulator") || descLower.includes("low dropout") || descLower.includes("regulator ldo")) {
        setMatch("LDO-Voltage Regulator", row, idx, "Description matches LDO Regulator");
        return;
      }
    }

    // 13. Voltage Detector
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("detector") || descLower.includes("reset") || descLower.includes("supervisor") || descLower.includes("voltage detector") || descLower.includes("reset ic")) {
        setMatch("Voltage Detector", row, idx, "Description matches Voltage Detector / Reset IC");
        return;
      }
    }

    // 14. E-Cap
    if (!matchedIndices.has(idx)) {
      if ((descLower.includes("e-cap") || descLower.includes("electrolytic") || descLower.includes("e-lytic")) && (descLower.includes("cap") || descLower.includes("capacitor"))) {
        setMatch("E-Cap", row, idx, "Description matches Electrolytic Capacitor");
        return;
      }
    }

    // 15. Aluminum Caps
    if (!matchedIndices.has(idx)) {
      if ((descLower.includes("aluminum") || descLower.includes("alum")) && (descLower.includes("cap") || descLower.includes("capacitor"))) {
        setMatch("Aluminum Caps", row, idx, "Description matches Aluminum Capacitor");
        return;
      }
    }

    // 16. RFI Shield
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("shield") || descLower.includes("metal shield") || descLower.includes("shield can") || descLower.includes("frame") || desigs.some(d => d.startsWith("SH"))) {
        setMatch("RFI Shield", row, idx, "Description matches RFI Shield / Shield Can");
        return;
      }
    }

    // 17. EEPROM
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("eeprom") || descLower.includes("i2c serial") || descLower.includes("serial eeprom")) {
        setMatch("EEPROM", row, idx, "Description matches EEPROM memory");
        return;
      }
    }

    // 18. MUX
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("mux") || descLower.includes("multiplexer") || descLower.includes("analog switch") || descLower.includes("switch multiplexer")) {
        setMatch("MUX", row, idx, "Description matches Multiplexer / Analog Switch");
        return;
      }
    }

    // 19. Temp Sensor
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("temp sensor") || descLower.includes("temperature sensor") || descLower.includes("thermal sensor") || descLower.includes("thermistor")) {
        setMatch("Temp Sensor", row, idx, "Description matches Temp/Thermal Sensor");
        return;
      }
    }

    // 20. Screw
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("screw") || descLower.includes("m2") || descLower.includes("m3") || descLower.includes("fastener") || descLower.includes("bolt")) {
        setMatch("Screw", row, idx, "Description matches Screw / Fastener");
        return;
      }
    }

    // 21. Carton
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("carton") || descLower.includes("box") || descLower.includes("packaging") || descLower.includes("label") || descLower.includes("shipping box")) {
        setMatch("Carton", row, idx, "Description matches Carton / Shipping packaging");
        return;
      }
    }

    // 22. Connector
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("connector") || descLower.includes("receptacle") || descLower.includes("header") || descLower.includes("plug") || desigs.some(d => d.startsWith("J") || d.startsWith("P") || d.startsWith("CN"))) {
        setMatch("Connector", row, idx, "Description or Designator matches Connector");
        return;
      }
    }

    // 23. Polymer Cap (Up to 2)
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("polymer cap") || descLower.includes("polymer solid") || descLower.includes("tantalum polymer")) {
        polymerCapsMatched.push(row);
        matchedIndices.add(idx);
        return;
      }
    }

    // 24. Inductor (Up to 4)
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("inductor") || descLower.includes("choke") || descLower.includes("coil") || desigs.some(d => d.startsWith("L"))) {
        inductorsMatched.push(row);
        matchedIndices.add(idx);
        return;
      }
    }

    // 25. Diode (Up to 4)
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("diode") || descLower.includes("tvs") || descLower.includes("schottky") || descLower.includes("zener") || desigs.some(d => d.startsWith("D") || d.startsWith("ZD"))) {
        diodesMatched.push(row);
        matchedIndices.add(idx);
        return;
      }
    }

    // 26. IC Translator (Up to 2)
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("translator") || descLower.includes("shifter") || descLower.includes("level translator") || descLower.includes("level shifter")) {
        translatorsMatched.push(row);
        matchedIndices.add(idx);
        return;
      }
    }

    // 27. TIM (Up to 4)
    if (!matchedIndices.has(idx)) {
      if (descLower.includes("tim") || descLower.includes("thermal interface") || descLower.includes("thermal pad") || descLower.includes("gap pad") || descLower.includes("thermal grease") || descLower.includes("thermal paste") || descLower.includes("thermal tape") || descLower.includes("phase change material")) {
        timsMatched.push(row);
        matchedIndices.add(idx);
        return;
      }
    }
  });

  // Assign PLP+PMIC slots
  if (plpPmicsMatched.length > 0) {
    const r = plpPmicsMatched[0];
    r.matchedColumn = "PLP+PMIC";
    r.matchReason = "Primary PLP+PMIC match";
    const { mfg: finalMfg, mfgPn: finalMfgPn } = resolveMfgForRow(r);
    const sourcePart = r.npbrQualMatrixPart.trim() || r.bomPrimaryPart.trim();
    mappedComponents["PLP+PMIC"] = {
      loc: r.loc,
      partNumber: applyPartPrefix(sourcePart, "PLP+PMIC"),
      mfg: finalMfg,
      mfgPn: finalMfgPn,
      sourceRow: r,
    };
  }
  if (plpPmicsMatched.length > 1) {
    const r = plpPmicsMatched[1];
    r.matchedColumn = "PLP+PMIC 2";
    r.matchReason = "Secondary PLP+PMIC match";
    const { mfg: finalMfg, mfgPn: finalMfgPn } = resolveMfgForRow(r);
    const sourcePart = r.npbrQualMatrixPart.trim() || r.bomPrimaryPart.trim();
    mappedComponents["PLP+PMIC 2"] = {
      loc: r.loc,
      partNumber: applyPartPrefix(sourcePart, "PLP+PMIC 2"),
      mfg: finalMfg,
      mfgPn: finalMfgPn,
      sourceRow: r,
    };
  }

  // Assign Polymer Caps
  const polySlots = ["Polymer Cap-1", "Polymer Cap-2"];
  polymerCapsMatched.slice(0, 2).forEach((r, idx) => {
    const colName = polySlots[idx];
    r.matchedColumn = colName;
    r.matchReason = `Polymer Capacitor match #${idx + 1}`;
    const { mfg: finalMfg, mfgPn: finalMfgPn } = resolveMfgForRow(r);
    const sourcePart = r.npbrQualMatrixPart.trim() || r.bomPrimaryPart.trim();
    mappedComponents[colName] = {
      loc: r.loc,
      partNumber: applyPartPrefix(sourcePart, colName),
      mfg: finalMfg,
      mfgPn: finalMfgPn,
      sourceRow: r,
    };
  });

  // Assign Inductors
  const inductorSlots = ["Inductor-1", "Inductor-2", "Inductor-3", "Inductor-4"];
  inductorsMatched.slice(0, 4).forEach((r, idx) => {
    const colName = inductorSlots[idx];
    r.matchedColumn = colName;
    r.matchReason = `Inductor match #${idx + 1}`;
    const { mfg: finalMfg, mfgPn: finalMfgPn } = resolveMfgForRow(r);
    const sourcePart = r.npbrQualMatrixPart.trim() || r.bomPrimaryPart.trim();
    mappedComponents[colName] = {
      loc: r.loc,
      partNumber: applyPartPrefix(sourcePart, colName),
      mfg: finalMfg,
      mfgPn: finalMfgPn,
      sourceRow: r,
    };
  });

  // Assign Diodes
  const diodeSlots = ["Diode-1", "Diode-2", "Diode-3", "Diode-4"];
  diodesMatched.slice(0, 4).forEach((r, idx) => {
    const colName = diodeSlots[idx];
    r.matchedColumn = colName;
    r.matchReason = `Diode match #${idx + 1}`;
    const { mfg: finalMfg, mfgPn: finalMfgPn } = resolveMfgForRow(r);
    const sourcePart = r.npbrQualMatrixPart.trim() || r.bomPrimaryPart.trim();
    mappedComponents[colName] = {
      loc: r.loc,
      partNumber: applyPartPrefix(sourcePart, colName),
      mfg: finalMfg,
      mfgPn: finalMfgPn,
      sourceRow: r,
    };
  });

  // Assign Translators
  const translatorSlots = ["IC Translator", "IC Translator2"];
  translatorsMatched.slice(0, 2).forEach((r, idx) => {
    const colName = translatorSlots[idx];
    r.matchedColumn = colName;
    r.matchReason = `IC Translator match #${idx + 1}`;
    const { mfg: finalMfg, mfgPn: finalMfgPn } = resolveMfgForRow(r);
    const sourcePart = r.npbrQualMatrixPart.trim() || r.bomPrimaryPart.trim();
    mappedComponents[colName] = {
      loc: r.loc,
      partNumber: applyPartPrefix(sourcePart, colName),
      mfg: finalMfg,
      mfgPn: finalMfgPn,
      sourceRow: r,
    };
  });

  // Assign TIMs
  const timSlots = ["TIM-1", "TIM-2", "TIM-3", "TIM-4"];
  timsMatched.slice(0, 4).forEach((r, idx) => {
    const colName = timSlots[idx];
    r.matchedColumn = colName;
    r.matchReason = `TIM match #${idx + 1}`;
    const { mfg: finalMfg, mfgPn: finalMfgPn } = resolveMfgForRow(r);
    const sourcePart = r.npbrQualMatrixPart.trim() || r.bomPrimaryPart.trim();
    mappedComponents[colName] = {
      loc: r.loc,
      partNumber: applyPartPrefix(sourcePart, colName),
      mfg: finalMfg,
      mfgPn: finalMfgPn,
      sourceRow: r,
    };
  });

  // Assign Enclosures
  const enclosureSlots = ["Enclosures-1", "Enclosures-2"];
  enclosuresMatched.slice(0, 2).forEach((r, idx) => {
    const colName = enclosureSlots[idx];
    r.matchedColumn = colName;
    r.matchReason = `Enclosure match #${idx + 1}`;
    const { mfg: finalMfg, mfgPn: finalMfgPn } = resolveMfgForRow(r);
    const sourcePart = r.npbrQualMatrixPart.trim() || r.bomPrimaryPart.trim();
    mappedComponents[colName] = {
      loc: r.loc,
      partNumber: applyPartPrefix(sourcePart, colName),
      mfg: finalMfg,
      mfgPn: finalMfgPn,
      sourceRow: r,
    };
  });

  // Fallback ASIC matching if still unmatched and description is super obvious
  if (!mappedComponents["ASIC"]) {
    const asicIdx = bomRows.findIndex((r, idx) => !matchedIndices.has(idx) && (r.description.toLowerCase().includes("asic") || r.description.toLowerCase().includes("controller chip")));
    if (asicIdx !== -1) {
      setMatch("ASIC", bomRows[asicIdx], asicIdx, "Fallback match based on ASIC in description");
    }
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    filename,
    projectName,
    stage,
    ff,
    capacity,
    sku,
    a198,
    a190,
    psSs,
    dwD,
    opPercent,
    soldAsCap,
    buildQty,
    specialInstructions,
    legNum,
    remark,
    stageConfidence,
    ffConfidence,
    projectConfidence: projectName ? 'high' : 'low',
    bomRows,
    mappedComponents,
  };
}

/**
 * Rewords the raw PS/SS header-block value (e.g. "(Primary Unlocked) TCG",
 * "(2nd Source Unlocked) TCG") into plain readable text for the Remark
 * field, per the mapping spec: Remark = PS/SS + special-instruction text.
 * Returns "" for blank/N-A values so it doesn't pollute the Remark with a
 * literal "N/A".
 */
export function formatPsSsForRemark(psSs: string): string {
  if (!psSs) return "";
  const trimmed = psSs.trim();
  if (!trimmed || /^n\/?a$/i.test(trimmed)) return "";
  return trimmed.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Builds an output row matching the 62 EXPORT_HEADERS based on parsed data
 */
export function buildExportRow(build: ParsedBuild): Record<string, string> {
  const row: Record<string, string> = {};

  // Initialize all to blank
  EXPORT_HEADERS.forEach(h => {
    row[h] = "";
  });

  // Source field mappings
  row["Project"] = build.projectName;
  row["Stage"] = build.stage;
  row["FF"] = build.ff;
  row["Capacity"] = build.capacity;
  row["Leg#"] = build.legNum;
  
  row["Sandisk PN"] = build.sku;
  
  // 9* PN <- A198 value, prepend prefix "9W0"
  if (build.a198) {
    row["9* PN"] = build.a198.trim().startsWith("9W0") ? build.a198.trim() : `9W0${build.a198.trim()}`;
  }
  
  row["Qty-1"] = build.buildQty;
  row["Qty-2"] = build.buildQty;
  
  // Remark = PS/SS (Primary/2nd Source) + the free-text special instruction,
  // per the mapping spec. build.psSs was already extracted per-leg earlier
  // but was previously dropped here - each leg is either a Primary-source or
  // 2nd-source build and that distinction needs to survive into the output.
  const psSsFormatted = formatPsSsForRemark(build.psSs);
  const combinedRemark = [psSsFormatted, build.remark].filter(Boolean).join(" — ");
  row["Remark"] = combinedRemark;
  row["REMARK"] = combinedRemark; // Set both just in case, though column 15 is Remark, column 62 is REMARK

  // WD PN <- A190 value, strip leading spaces
  if (build.a190) {
    row["WD PN"] = build.a190.trim();
  }


  // Component cell mappings
  EXPORT_HEADERS.forEach(col => {
    // These columns are filled via BOM component mapping
    if (build.mappedComponents[col]) {
      const cell = build.mappedComponents[col]!;
      // Format cell: 4 lines, newline-separated
      row[col] = `${cell.loc}\n${cell.partNumber}\n${cell.mfg}\n${cell.mfgPn}`;
    }
  });

  // Apply user-defined cell overrides if any
  if (build.overrides) {
    Object.keys(build.overrides).forEach(col => {
      row[col] = build.overrides![col];
    });
  }

  return row;
}

/**
 * Generates the complete CSV text
 */
export function generateExportCsv(builds: ParsedBuild[]): string {
  const outputRows = builds.map(b => buildExportRow(b));
  
  // Create PapaParse compliant structure
  const data = outputRows.map(row => {
    return EXPORT_HEADERS.map(header => row[header] || "");
  });

  return Papa.unparse({
    fields: EXPORT_HEADERS,
    data: data,
  });
}
