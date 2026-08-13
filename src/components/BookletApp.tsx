import React, { useState, useRef, useEffect } from 'react';
import { PDFDocument, PDFName } from 'pdf-lib';
import './BookletApp.css';

interface BookletAppProps {
  defaultPreset?: string;
  defaultMode?: 'signature' | 'booklet';
  defaultScaling?: 'fit' | 'original';
}

export default function BookletApp({
  defaultPreset = 'auto',
  defaultMode = 'signature',
  defaultScaling = 'fit',
}: BookletAppProps) {
  // File State
  const [file, setFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<{
    pageCount: number;
    originalWidth: number;
    originalHeight: number;
  } | null>(null);

  // Settings State
  const [impositionMode, setImpositionMode] = useState<'signature' | 'booklet'>(defaultMode);
  const [paperPreset, setPaperPreset] = useState<string>(defaultPreset);
  const [customWidth, setCustomWidth] = useState<string>('297'); // A4 landscape width in mm as custom default
  const [customHeight, setCustomHeight] = useState<string>('210'); // A4 landscape height in mm
  const [customUnit, setCustomUnit] = useState<'mm' | 'cm' | 'in' | 'pt'>('mm');
  const [scalingOption, setScalingOption] = useState<'fit' | 'original'>(defaultScaling);
  const [outerBleedVal, setOuterBleedVal] = useState<string>('0');
  const [outerBleedUnit, setOuterBleedUnit] = useState<'mm' | 'pt'>('mm');
  const [centerGutterVal, setCenterGutterVal] = useState<string>('0');
  const [centerGutterUnit, setCenterGutterUnit] = useState<'mm' | 'pt'>('mm');
  const [removeBlankPages, setRemoveBlankPages] = useState<boolean>(false);
  const [nonBlankIndices, setNonBlankIndices] = useState<number[]>([]);
  const [pdfDocInstance, setPdfDocInstance] = useState<any>(null);
  const [pdfjsLibInstance, setPdfjsLibInstance] = useState<any>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Preview Navigation State
  const [currentSheetIdx, setCurrentSheetIdx] = useState<number>(0);
  const [previewSide, setPreviewSide] = useState<'A' | 'B'>('A'); // Side A (Front), Side B (Back)

  // System & Worker State
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const workerRef = useRef<Worker | null>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  // Load pdfjs-dist dynamically on client-side to prevent SSR / static build ReferenceError (e.g. DOMMatrix)
  useEffect(() => {
    async function initPdfjs() {
      try {
        const pdfjs = await import('pdfjs-dist');
        const pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker.default;
        setPdfjsLibInstance(pdfjs);
      } catch (err) {
        console.error('Failed to initialize pdfjs-dist:', err);
      }
    }
    initPdfjs();

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Load PDFJS document preview whenever file or pdfjsLibInstance changes
  useEffect(() => {
    if (!file || !pdfjsLibInstance) {
      setPdfDocInstance(null);
      return;
    }

    let active = true;
    async function loadPdfjsDoc() {
      try {
        const arrayBuffer = await file.arrayBuffer();
        if (!active) return;
        const loadingTask = pdfjsLibInstance.getDocument({ data: new Uint8Array(arrayBuffer) });
        const pdfjsDoc = await loadingTask.promise;
        if (active) {
          setPdfDocInstance(pdfjsDoc);
        }
      } catch (err) {
        console.error('Error loading PDF with PDF.js:', err);
      }
    }
    loadPdfjsDoc();

    return () => {
      active = false;
    };
  }, [file, pdfjsLibInstance]);

  // Listen for escape key in fullscreen mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    if (isFullscreen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  // Conversions to points
  const convertToPoints = (value: number, unit: string): number => {
    if (isNaN(value)) return 0;
    switch (unit) {
      case 'mm':
        return value * (72 / 25.4);
      case 'cm':
        return value * (72 / 2.54);
      case 'in':
        return value * 72;
      case 'pt':
      default:
        return value;
    }
  };

  const handleFileChange = async (selectedFile: File | null) => {
    if (!selectedFile) return;

    // Check magic bytes
    if (selectedFile.type !== 'application/pdf' && !selectedFile.name.endsWith('.pdf')) {
      setStatusMessage({ type: 'error', text: 'Please select a valid PDF file.' });
      return;
    }

    try {
      setStatusMessage(null);
      setFile(selectedFile);
      setIsProcessing(true);

      const arrayBuffer = await selectedFile.arrayBuffer();
      // Basic validation: magic bytes check
      const arr = new Uint8Array(arrayBuffer.slice(0, 5));
      const header = String.fromCharCode(...arr);
      if (!header.startsWith('%PDF-')) {
        throw new Error('Invalid file structure: Missing %PDF header bytes.');
      }

      // Load document to get pages metadata
      const pdfDoc = await PDFDocument.load(arrayBuffer, { updateMetadata: false });
      const pages = pdfDoc.getPages();
      const pageCount = pages.length;
      const firstPage = pages[0];
      const originalWidth = firstPage.getWidth();
      const originalHeight = firstPage.getHeight();

      const nonBlank: number[] = [];
      pages.forEach((page, idx) => {
        if (page.node.get(PDFName.of('Contents'))) {
          nonBlank.push(idx);
        }
      });
      setNonBlankIndices(nonBlank);

      setFileData({
        pageCount,
        originalWidth,
        originalHeight,
      });
      setCurrentSheetIdx(0);
      setPreviewSide('A');
    } catch (err: any) {
      setFile(null);
      setFileData(null);
      setStatusMessage({ type: 'error', text: err?.message || 'Error parsing PDF metadata.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (dropzoneRef.current) {
      dropzoneRef.current.classList.add('active');
    }
  };

  const onDragLeave = () => {
    if (dropzoneRef.current) {
      dropzoneRef.current.classList.remove('active');
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dropzoneRef.current) {
      dropzoneRef.current.classList.remove('active');
    }
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // Imposition generation trigger
  const handleGenerate = async () => {
    if (!file) return;

    try {
      setIsProcessing(true);
      setProgress(0);
      setStatusMessage(null);

      const arrayBuffer = await file.arrayBuffer();

      // Convert customized dimension presets
      let finalCustomWidth = 0;
      let finalCustomHeight = 0;
      if (paperPreset === 'custom') {
        finalCustomWidth = convertToPoints(parseFloat(customWidth), customUnit);
        finalCustomHeight = convertToPoints(parseFloat(customHeight), customUnit);
      }

      const finalOuterBleed = convertToPoints(parseFloat(outerBleedVal), outerBleedUnit);
      const finalCenterGutter = convertToPoints(parseFloat(centerGutterVal), centerGutterUnit);

      // Create inline worker
      if (workerRef.current) {
        workerRef.current.terminate();
      }

      // Initialize native Vite web worker syntax
      workerRef.current = new Worker(
        new URL('../workers/imposition.worker.ts', import.meta.url),
        { type: 'module' }
      );

      workerRef.current.onmessage = (event: MessageEvent) => {
        const { type, percent, pdfBytes, message } = event.data;

        if (type === 'progress') {
          setProgress(percent);
        } else if (type === 'complete') {
          setIsProcessing(false);
          setProgress(100);

          // Create blob download links client-side
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${file.name.replace(/\.[^/.]+$/, '')}_booklet.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          // Clean memory URL immediately after execution to guard heap
          setTimeout(() => URL.revokeObjectURL(url), 100);

          setStatusMessage({
            type: 'success',
            text: 'Your booklet was imposed successfully! Download started.',
          });
        } else if (type === 'error') {
          setIsProcessing(false);
          setStatusMessage({ type: 'error', text: message });
        }
      };

      workerRef.current.postMessage({
        pdfBytes: arrayBuffer,
        impositionMode,
        paperPreset,
        customWidth: finalCustomWidth,
        customHeight: finalCustomHeight,
        scalingOption,
        outerBleed: finalOuterBleed,
        centerGutter: finalCenterGutter,
        removeBlankPages,
      });
    } catch (err: any) {
      setIsProcessing(false);
      setStatusMessage({ type: 'error', text: err?.message || 'Initialization error.' });
    }
  };

  // Math mapping calculations for preview spreads
  const getPreviewPages = () => {
    if (!fileData) return { leftIdx: -1, rightIdx: -1 };

    const total = removeBlankPages ? nonBlankIndices.length : fileData.pageCount;
    const remainder = total % 4;
    const padded = remainder === 0 ? total : total + (4 - remainder);

    const k = currentSheetIdx;
    let leftVirtualIdx = -1;
    let rightVirtualIdx = -1;

    if (impositionMode === 'signature') {
      if (previewSide === 'A') {
        leftVirtualIdx = 4 * k + 3;
        rightVirtualIdx = 4 * k + 0;
      } else {
        leftVirtualIdx = 4 * k + 1;
        rightVirtualIdx = 4 * k + 2;
      }
    } else {
      // Saddle Stitch Booklet
      if (previewSide === 'A') {
        leftVirtualIdx = padded - 2 * k - 1;
        rightVirtualIdx = 2 * k;
      } else {
        leftVirtualIdx = 2 * k + 1;
        rightVirtualIdx = padded - 2 * k - 2;
      }
    }

    const mapVirtualToOriginalIndex = (vIdx: number) => {
      if (vIdx < 0 || vIdx >= total) return -1;
      return removeBlankPages ? nonBlankIndices[vIdx] : vIdx;
    };

    return {
      leftIdx: mapVirtualToOriginalIndex(leftVirtualIdx),
      rightIdx: mapVirtualToOriginalIndex(rightVirtualIdx),
    };
  };

  const getPaddedPageCount = () => {
    if (!fileData) return 0;
    const total = removeBlankPages ? nonBlankIndices.length : fileData.pageCount;
    const remainder = total % 4;
    return remainder === 0 ? total : total + (4 - remainder);
  };

  const totalSheets = fileData ? getPaddedPageCount() / 4 : 0;
  const previewPages = getPreviewPages();

  return (
    <div className="booklet-container">
      {/* Left Column: Input, Preview & Visualizer */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* File Dropzone */}
        <div className="glass-panel">
          <h2 className="panel-title">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Upload PDF Document
          </h2>
          
          <div
            ref={dropzoneRef}
            className="dropzone"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => document.getElementById('pdf-file-selector')?.click()}
          >
            <svg className="dropzone-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div className="dropzone-text">
              <h3>Drag & drop your PDF file here</h3>
              <p>or click to select from your device</p>
            </div>
            <input
              id="pdf-file-selector"
              type="file"
              accept=".pdf"
              className="file-input"
              onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            />
          </div>

          {file && fileData && (
            <div className="file-info-box">
              <div className="file-details">
                <svg className="file-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <div className="file-name" title={file.name}>{file.name}</div>
                  <div className="file-size">
                    {(file.size / 1024 / 1024).toFixed(2)} MB &bull; {fileData.pageCount} pages ({getPaddedPageCount()} padded)
                  </div>
                </div>
              </div>
              <button
                className="btn-remove"
                title="Remove file"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  setFileData(null);
                  setNonBlankIndices([]);
                  setPdfDocInstance(null);
                  setProgress(0);
                  setStatusMessage(null);
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" style={{ width: '1.25rem', height: '1.25rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Live Visual Spread Preview */}
        <div className={`glass-panel ${isFullscreen ? 'fullscreen-preview-mode' : ''}`} style={{ flexGrow: 1 }}>
          <div className="preview-header">
            <h2 className="panel-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Live Imposition Spread Preview
            </h2>
            
            {fileData && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div className="preview-nav">
                  <button
                    className="btn-nav"
                    onClick={() => setCurrentSheetIdx(Math.max(0, currentSheetIdx - 1))}
                    disabled={currentSheetIdx === 0}
                    title="Previous Sheet"
                  >
                    &larr;
                  </button>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, padding: '0 0.5rem' }}>
                    Sheet {currentSheetIdx + 1} of {totalSheets}
                  </span>
                  <button
                    className="btn-nav"
                    onClick={() => setCurrentSheetIdx(Math.min(totalSheets - 1, currentSheetIdx + 1))}
                    disabled={currentSheetIdx === totalSheets - 1}
                    title="Next Sheet"
                  >
                    &rarr;
                  </button>
                </div>

                <button
                  className="btn-action-icon"
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  title={isFullscreen ? "Exit Fullscreen (Esc)" : "Enter Fullscreen"}
                  style={{
                    background: 'rgba(30, 41, 66, 0.6)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    padding: '0.45rem',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s',
                  }}
                >
                  {isFullscreen ? (
                    <svg xmlns="http://www.w3.org/2000/svg" style={{ width: '1.25rem', height: '1.25rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" style={{ width: '1.25rem', height: '1.25rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4M4 20l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                    </svg>
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="preview-grid">
            {fileData ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '1.25rem' }}>
                {/* Side Toggle Tabs */}
                <div className="radio-group" style={{ maxWidth: '200px', margin: '0 auto' }}>
                  <button
                    className={`radio-btn ${previewSide === 'A' ? 'active' : ''}`}
                    onClick={() => setPreviewSide('A')}
                  >
                    Front (Side A)
                  </button>
                  <button
                    className={`radio-btn ${previewSide === 'B' ? 'active' : ''}`}
                    onClick={() => setPreviewSide('B')}
                  >
                    Back (Side B)
                  </button>
                </div>

                {/* Simulated Sheet Paper */}
                <div className="sheet-spread">
                  <div className="sheet-page-slot">
                    <PdfPageCanvas pdfDoc={pdfDocInstance} pageIndex={previewPages.leftIdx} label="Left Slot" isFullscreen={isFullscreen} />
                  </div>
                  <div className="center-fold-line"></div>
                  {centerGutterVal !== '0' && <div className="gutter-overlay"></div>}
                  {outerBleedVal !== '0' && <div className="bleed-overlay"></div>}
                  <div className="sheet-page-slot">
                    <PdfPageCanvas pdfDoc={pdfDocInstance} pageIndex={previewPages.rightIdx} label="Right Slot" isFullscreen={isFullscreen} />
                  </div>
                </div>

                <div className="sheet-details">
                  <div className="sheet-subtitle">
                    Imposition mapping for folded stack: <strong>{previewPages.leftIdx === -1 ? 'Blank' : `Page ${previewPages.leftIdx + 1}`}</strong> is on the left, <strong>{previewPages.rightIdx === -1 ? 'Blank' : `Page ${previewPages.rightIdx + 1}`}</strong> is on the right
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-preview-state">
                <svg className="empty-preview-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a1 1 0 011.414 0L16 17m-2-2l1.586-1.586a1 1 0 011.414 0L21 14m-7-2a1 1 0 11-2 0 1 1 0 012 0z" />
                </svg>
                <p>Upload a single-page PDF to preview target sheet spreads.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Column: Settings & Actions */}
      <div className="glass-panel" style={{ height: 'fit-content' }}>
        <h2 className="panel-title">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          Imposition Settings
        </h2>

        {/* Imposition Mode */}
        <div className="settings-group">
          <label className="settings-label">Imposition Mode</label>
          <div className="radio-group">
            <button
              className={`radio-btn ${impositionMode === 'signature' ? 'active' : ''}`}
              onClick={() => {
                setImpositionMode('signature');
                setCurrentSheetIdx(0);
              }}
              disabled={isProcessing}
            >
              4-Page Signature
            </button>
            <button
              className={`radio-btn ${impositionMode === 'booklet' ? 'active' : ''}`}
              onClick={() => {
                setImpositionMode('booklet');
                setCurrentSheetIdx(0);
              }}
              disabled={isProcessing}
            >
              Saddle-Stitch Booklet
            </button>
          </div>
        </div>

        {/* Target Paper Preset */}
        <div className="settings-group">
          <label className="settings-label">Target Paper Size</label>
          <select
            className="select-input"
            value={paperPreset}
            onChange={(e) => setPaperPreset(e.target.value)}
            disabled={isProcessing}
          >
            <option value="auto">Auto (2x Source Width, Same Height)</option>
            <option value="a3">A3 Landscape (1190 x 841 pt)</option>
            <option value="a4">A4 Landscape (841 x 595 pt)</option>
            <option value="a5">A5 Landscape (595 x 420 pt)</option>
            <option value="letter">Letter Landscape (792 x 612 pt)</option>
            <option value="legal">Legal Landscape (1008 x 612 pt)</option>
            <option value="custom">Custom Dimensions</option>
          </select>
        </div>

        {/* Custom Sizing Panel */}
        {paperPreset === 'custom' && (
          <div className="custom-dimensions">
            <div className="form-row" style={{ marginBottom: '0.5rem' }}>
              <div>
                <label className="settings-label" style={{ fontSize: '0.75rem' }}>Width</label>
                <input
                  type="number"
                  className="text-input"
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value)}
                  disabled={isProcessing}
                />
              </div>
              <div>
                <label className="settings-label" style={{ fontSize: '0.75rem' }}>Height</label>
                <input
                  type="number"
                  className="text-input"
                  value={customHeight}
                  onChange={(e) => setCustomHeight(e.target.value)}
                  disabled={isProcessing}
                />
              </div>
            </div>
            <div>
              <label className="settings-label" style={{ fontSize: '0.75rem' }}>Unit</label>
              <select
                className="select-input"
                style={{ padding: '0.5rem' }}
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value as any)}
                disabled={isProcessing}
              >
                <option value="mm">Millimeters (mm)</option>
                <option value="cm">Centimeters (cm)</option>
                <option value="in">Inches (in)</option>
                <option value="pt">Points (pt)</option>
              </select>
            </div>
          </div>
        )}

        {/* Scaling Mode */}
        <div className="settings-group">
          <label className="settings-label">Page Scaling</label>
          <select
            className="select-input"
            value={scalingOption}
            onChange={(e) => setScalingOption(e.target.value as any)}
            disabled={isProcessing}
          >
            <option value="fit">Fit to Half-Sheet (Proportional)</option>
            <option value="original">Original 100% Scale (Center Crop/Pad)</option>
          </select>
        </div>

        {/* Bleed Margin & Gutter Layout */}
        <div className="form-row">
          <div className="settings-group">
            <label className="settings-label">Outer Bleed</label>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <input
                type="number"
                className="text-input"
                style={{ padding: '0.6rem 0.4rem', flex: 1 }}
                value={outerBleedVal}
                onChange={(e) => setOuterBleedVal(e.target.value)}
                disabled={isProcessing}
                min="0"
              />
              <select
                className="select-input"
                style={{ padding: '0.6rem 0.2rem', width: '60px', flexShrink: 0 }}
                value={outerBleedUnit}
                onChange={(e) => setOuterBleedUnit(e.target.value as any)}
                disabled={isProcessing}
              >
                <option value="mm">mm</option>
                <option value="pt">pt</option>
              </select>
            </div>
          </div>

          <div className="settings-group">
            <label className="settings-label">Center Gutter</label>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <input
                type="number"
                className="text-input"
                style={{ padding: '0.6rem 0.4rem', flex: 1 }}
                value={centerGutterVal}
                onChange={(e) => setCenterGutterVal(e.target.value)}
                disabled={isProcessing}
                min="0"
              />
              <select
                className="select-input"
                style={{ padding: '0.6rem 0.2rem', width: '60px', flexShrink: 0 }}
                value={centerGutterUnit}
                onChange={(e) => setCenterGutterUnit(e.target.value as any)}
                disabled={isProcessing}
              >
                <option value="mm">mm</option>
                <option value="pt">pt</option>
              </select>
            </div>
          </div>
        </div>

        {/* Remove Blank Pages Toggle */}
        <div className="settings-group checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              className="checkbox-input"
              checked={removeBlankPages}
              onChange={(e) => setRemoveBlankPages(e.target.checked)}
              disabled={isProcessing}
            />
            <span>Remove Blank / Empty Pages</span>
          </label>
        </div>

        {/* Generate / Action Trigger */}
        <button
          className="btn-generate"
          onClick={handleGenerate}
          disabled={isProcessing || !file}
        >
          {isProcessing ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" style={{ width: '1.25rem', height: '1.25rem', animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.248 8H15V3" />
              </svg>
              Generating PDF...
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" style={{ width: '1.25rem', height: '1.25rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Generate & Download Booklet
            </>
          )}
        </button>

        {/* Progress Bar (Visible when compiling) */}
        {isProcessing && progress > 0 && (
          <div className="progress-container">
            <div className="progress-info">
              <span>Compiling PDF sheets</span>
              <span>{progress}%</span>
            </div>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        )}

        {/* Status Messaging */}
        {statusMessage && (
          <div className={`status-msg ${statusMessage.type}`}>
            {statusMessage.type === 'error' ? (
              <svg xmlns="http://www.w3.org/2000/svg" style={{ width: '1.25rem', height: '1.25rem', flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" style={{ width: '1.25rem', height: '1.25rem', flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}
      </div>

      {/* Inline styles for keyframe spinner */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

interface PdfPageCanvasProps {
  pdfDoc: any;
  pageIndex: number;
  label: string;
  isFullscreen?: boolean;
}

function PdfPageCanvas({ pdfDoc, pageIndex, label, isFullscreen }: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!pdfDoc || pageIndex === -1) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
      return;
    }

    let active = true;
    let renderTask: any = null;

    async function drawPage() {
      try {
        const page = await pdfDoc.getPage(pageIndex + 1);
        if (!active || !canvasRef.current) return;

        const parent = canvasRef.current.parentElement;
        const width = parent ? parent.clientWidth : 200;
        const height = parent ? parent.clientHeight : 250;

        const viewport = page.getViewport({ scale: 1.0 });
        const scale = Math.min(width / viewport.width, height / viewport.height);
        const scaledViewport = page.getViewport({ scale: scale * 0.95 });

        canvasRef.current.width = scaledViewport.width;
        canvasRef.current.height = scaledViewport.height;

        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, scaledViewport.width, scaledViewport.height);

        renderTask = page.render({
          canvasContext: ctx,
          viewport: scaledViewport,
        });

        await renderTask.promise;
      } catch (err) {
        console.error('Error rendering preview page:', err);
      }
    }

    drawPage();

    return () => {
      active = false;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, pageIndex, isFullscreen]);

  if (pageIndex === -1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#94a3b8' }}>Blank Page</span>
        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginTop: '0.25rem' }}>{label}</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%', justifyContent: 'center' }}>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)', borderRadius: '4px' }} />
      <span style={{ marginTop: '0.5rem', color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}>
        {label} (Page {pageIndex + 1})
      </span>
    </div>
  );
}
