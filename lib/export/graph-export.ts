import { toPng } from 'html-to-image';

/**
 * Exports a ReactFlow dependency graph as a high-resolution PNG image
 * @param graphElement - The HTML element containing the ReactFlow graph
 */
export async function exportGraphToPNG(graphElement: HTMLElement): Promise<void> {
  if (!graphElement) {
    throw new Error('Graph element not found. Cannot export.');
  }

  // Check if the element has any content
  const hasContent = graphElement.querySelector('.react-flow__nodes');
  if (!hasContent) {
    throw new Error('Graph is empty. Add dependencies to export the graph.');
  }

  // Check for Canvas API support
  if (!document.createElement('canvas').getContext) {
    throw new Error('Your browser does not support Canvas API. Please use a modern browser.');
  }

  try {
    // Store original styles
    const originalBackground = graphElement.style.backgroundColor;
    const originalBackdrop = graphElement.style.backdropFilter;

    // Find and hide interactive controls temporarily
    const controls = graphElement.querySelectorAll('.react-flow__controls, .react-flow__panel');
    const controlsOriginalDisplay: string[] = [];
    controls.forEach((control, index) => {
      controlsOriginalDisplay[index] = (control as HTMLElement).style.display;
      (control as HTMLElement).style.display = 'none';
    });

    // Apply white background for professional printing
    graphElement.style.backgroundColor = '#ffffff';
    graphElement.style.backdropFilter = 'none';

    // Calculate dimensions (minimum 1920x1080)
    const rect = graphElement.getBoundingClientRect();
    const width = Math.max(rect.width, 1920);
    const height = Math.max(rect.height, 1080);

    // Generate PNG with high quality settings
    const dataUrl = await toPng(graphElement, {
      cacheBust: true,
      quality: 1.0,
      pixelRatio: 2, // Retina display quality
      width,
      height,
      backgroundColor: '#ffffff',
      style: {
        transform: 'scale(1)',
        transformOrigin: 'top left',
      },
    });

    // Restore original styles
    graphElement.style.backgroundColor = originalBackground;
    graphElement.style.backdropFilter = originalBackdrop;

    // Restore controls
    controls.forEach((control, index) => {
      (control as HTMLElement).style.display = controlsOriginalDisplay[index];
    });

    // Add watermark to the image
    const watermarkedDataUrl = await addWatermark(dataUrl, width, height);

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const filename = `devcontrol-dependency-graph-${timestamp}.png`;

    // Create download link and trigger download
    const link = document.createElement('a');
    link.download = filename;
    link.href = watermarkedDataUrl;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();

    // Cleanup
    document.body.removeChild(link);

    // Note: We don't revoke the data URL immediately as it might still be needed
    // The browser will clean it up automatically

    console.log(`PNG export successful: ${filename}`);
  } catch (error) {
    console.error('PNG export failed:', error);
    throw new Error(
      `Failed to export graph as PNG: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Adds a DevControl watermark to the bottom-right corner of the image
 */
async function addWatermark(
  imageDataUrl: string,
  width: number,
  height: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Cannot get canvas context'));
      return;
    }

    canvas.width = width;
    canvas.height = height;

    const image = new Image();
    image.onload = () => {
      // Draw the original image
      ctx.drawImage(image, 0, 0, width, height);

      // Add watermark text
      const timestamp = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const watermarkText = `DevControl - ${timestamp}`;

      // Configure watermark style
      ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';

      // Draw watermark at bottom-right with padding
      const padding = 20;
      ctx.fillText(watermarkText, width - padding, height - padding);

      // Convert to data URL
      resolve(canvas.toDataURL('image/png', 1.0));
    };

    image.onerror = () => {
      reject(new Error('Failed to load image for watermarking'));
    };

    image.src = imageDataUrl;
  });
}
