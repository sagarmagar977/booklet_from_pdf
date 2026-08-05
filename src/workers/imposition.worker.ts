import { PDFDocument } from 'pdf-lib';

// Target paper dimensions in points (1 pt = 1/72 inch)
const PAPER_PRESETS: Record<string, { width: number; height: number }> = {
  a3: { width: 1190.55, height: 841.89 },
  a4: { width: 841.89, height: 595.28 },
  a5: { width: 595.28, height: 420.94 },
  letter: { width: 792, height: 612 },
  legal: { width: 1008, height: 612 },
};

self.onmessage = async (e: MessageEvent) => {
  try {
    const {
      pdfBytes,
      impositionMode,
      paperPreset,
      customWidth,
      customHeight,
      scalingOption,
      outerBleed,
      centerGutter,
    } = e.data;

    // 1. Load source PDF document
    const sourceDoc = await PDFDocument.load(pdfBytes);
    const sourcePages = sourceDoc.getPages();
    const totalPages = sourcePages.length;

    if (totalPages === 0) {
      throw new Error('The uploaded PDF has no pages.');
    }

    // 2. Pad page count to a multiple of 4
    const remainder = totalPages % 4;
    const paddedCount = remainder === 0 ? totalPages : totalPages + (4 - remainder);

    // Create array of page indices (0-based). Use -1 for blank padded pages.
    const pageIndices: number[] = [];
    for (let i = 0; i < paddedCount; i++) {
      if (i < totalPages) {
        pageIndices.push(i);
      } else {
        pageIndices.push(-1); // Blank page
      }
    }

    // 3. Determine output page (sheet) size
    let sheetWidth = 0;
    let sheetHeight = 0;

    const firstPage = sourcePages[0];
    const sourceWidth = firstPage.getWidth();
    const sourceHeight = firstPage.getHeight();

    if (paperPreset === 'auto') {
      // Default Mode: Same as Source (Landscape 2-up)
      sheetWidth = sourceWidth * 2;
      sheetHeight = sourceHeight;
    } else if (paperPreset === 'custom') {
      sheetWidth = customWidth;
      sheetHeight = customHeight;
    } else {
      const size = PAPER_PRESETS[paperPreset.toLowerCase()];
      if (size) {
        sheetWidth = size.width;
        sheetHeight = size.height;
      } else {
        sheetWidth = sourceWidth * 2;
        sheetHeight = sourceHeight;
      }
    }

    // 4. Calculate slot boundaries on sheet (taking bleed and center gutter into account)
    // Both Left and Right slots are identical in size
    const slotWidth = (sheetWidth - 2 * outerBleed - centerGutter) / 2;
    const slotHeight = sheetHeight - 2 * outerBleed;

    if (slotWidth <= 0 || slotHeight <= 0) {
      throw new Error('Bleed margins and center gutter exceed the dimensions of the output paper.');
    }

    const slotLeftX = outerBleed;
    const slotRightX = outerBleed + slotWidth + centerGutter;
    const slotY = outerBleed;

    // 5. Generate output PDF document
    const destDoc = await PDFDocument.create();

    // Embed all source pages into the destination document
    const embeddedPages = await destDoc.embedPages(sourcePages);

    // Helper to draw a page onto a sheet slot
    const drawPageInSlot = (
      destPage: any,
      sourceIdx: number,
      slotX: number,
      slotWidth: number,
      slotHeight: number
    ) => {
      if (sourceIdx === -1) {
        // Blank padded page: draw nothing (keeps sheet color which is white by default)
        return;
      }

      const origPage = sourcePages[sourceIdx];
      const origWidth = origPage.getWidth();
      const origHeight = origPage.getHeight();

      let scale = 1.0;
      if (scalingOption === 'fit') {
        scale = Math.min(slotWidth / origWidth, slotHeight / origHeight);
      }

      const drawWidth = origWidth * scale;
      const drawHeight = origHeight * scale;

      // Center the page within the slot
      const x = slotX + (slotWidth - drawWidth) / 2;
      const y = slotY + (slotHeight - drawHeight) / 2;

      destPage.drawPage(embeddedPages[sourceIdx], {
        x,
        y,
        width: drawWidth,
        height: drawHeight,
      });
    };

    const numSheets = paddedCount / 4;

    // For tracking progress
    let sheetsCompleted = 0;

    for (let k = 0; k < numSheets; k++) {
      let frontLeftIdx = -1;
      let frontRightIdx = -1;
      let backLeftIdx = -1;
      let backRightIdx = -1;

      if (impositionMode === 'signature') {
        // 4-Page Signature Mode
        frontLeftIdx = pageIndices[4 * k + 3];
        frontRightIdx = pageIndices[4 * k + 0];
        backLeftIdx = pageIndices[4 * k + 1];
        backRightIdx = pageIndices[4 * k + 2];
      } else {
        // Saddle-Stitch Booklet Mode
        frontLeftIdx = pageIndices[paddedCount - 2 * k - 1];
        frontRightIdx = pageIndices[2 * k];
        backLeftIdx = pageIndices[2 * k + 1];
        backRightIdx = pageIndices[paddedCount - 2 * k - 2];
      }

      // Add Front sheet (Side A)
      const frontPage = destDoc.addPage([sheetWidth, sheetHeight]);
      drawPageInSlot(frontPage, frontLeftIdx, slotLeftX, slotWidth, slotHeight);
      drawPageInSlot(frontPage, frontRightIdx, slotRightX, slotWidth, slotHeight);

      // Add Back sheet (Side B)
      const backPage = destDoc.addPage([sheetWidth, sheetHeight]);
      drawPageInSlot(backPage, backLeftIdx, slotLeftX, slotWidth, slotHeight);
      drawPageInSlot(backPage, backRightIdx, slotRightX, slotWidth, slotHeight);

      sheetsCompleted++;
      self.postMessage({
        type: 'progress',
        percent: Math.round((sheetsCompleted / numSheets) * 100),
      });
    }

    // Serialize destination document to bytes
    const destPdfBytes = await destDoc.save();

    self.postMessage({
      type: 'complete',
      pdfBytes: destPdfBytes,
      sheetWidth,
      sheetHeight,
      totalPages: paddedCount,
    });
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      message: err?.message || 'An unknown error occurred during PDF imposition.',
    });
  }
};
