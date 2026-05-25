# SuperSplat-Seg

A fork of the [SuperSplat Editor](https://github.com/playcanvas/supersplat) extended with research tools for segmentation, alignment, and Z-up coordinate support — developed at the CMU Kantor Lab.

> **Upstream:** SuperSplat v2.27.0 | Engine v2.18.2 | PCUI v6.1.4

## New Features

### Semantic Labeling (Segmentation)
Assign semantic class labels to individual Gaussians and visualize them with a color overlay.

- Open the **Semantic Labels** panel via the annotation button in the bottom toolbar.
- **Add Class** to create a new label class with an auto-generated color.
- Select Gaussians using any existing selection tool, then click **Assign Selection** to label them with the active class.
- Click a class row to make it active; click **Select** to select all Gaussians with that label.
- Toggle the overlay on/off and adjust opacity with the **Overlay** and **Opacity** controls.
- **Export Centroids JSON** writes a JSON file with per-class centroid positions and splat counts, useful for downstream analysis.

Labels are stored in a per-Gaussian `semantic` channel and are preserved across undo/redo.

### Splat Alignment
Align two loaded Gaussian splat scenes by picking correspondence point pairs.

- Load two splats and activate the **Align** tool from the bottom toolbar.
- Pick source and target points on each splat to build correspondence pairs.
- Click **Align** to compute and apply an ICP-based rigid transform to the source splat.

### Z-Up Coordinate Mode
Toggle between Y-up (default) and Z-up coordinate systems for data captured in a Z-up frame.

- Enable **Z-Up** in the **View** panel.
- The scene root rotates −90° on X so that data-Z maps to world-Y, keeping the infinite grid and all tools consistent.
- The transform gizmo Y/Z axis colors swap to reflect the active convention.

### Point Cloud Import
`.ply` files containing point cloud data (no Gaussian covariance) can now be imported directly alongside splat files.

## Local Development

To initialize a local development environment for SuperSplat, ensure you have [Node.js](https://nodejs.org/) 18 or later installed. Follow these steps:

1. Clone the repository:

   ```sh
   git clone https://github.com/playcanvas/supersplat.git
   cd supersplat
   ```

2. Install dependencies:

   ```sh
   npm install
   ```

3. Build SuperSplat and start a local web server:

   ```sh
   npm run develop
   ```

4. Open a web browser tab and make sure network caching is disabled on the network tab and the other application caches are clear:

   - On Safari you can use `Cmd+Option+e` or Develop->Empty Caches.
   - On Chrome ensure the options "Update on reload" and "Bypass for network" are enabled in the Application->Service workers tab:

   <img width="846" alt="Screenshot 2025-04-25 at 16 53 37" src="https://github.com/user-attachments/assets/888bac6c-25c1-4813-b5b6-4beecf437ac9" />

5. Navigate to `http://localhost:3000`

When changes to the source are detected, SuperSplat is rebuilt automatically. Simply refresh your browser to see your changes.

## Localizing the SuperSplat Editor

The currently supported languages are available here:

https://github.com/playcanvas/supersplat/tree/main/static/locales

### Adding a New Language

1. Add a new `<locale>.json` file in the `static/locales` directory.

2. Add the locale to the list here:

   https://github.com/playcanvas/supersplat/blob/main/src/ui/localization.ts

### Testing Translations

To test your translations:

1. Run the development server:

   ```sh
   npm run develop
   ```

2. Open your browser and navigate to:

   ```
   http://localhost:3000/?lng=<locale>
   ```

   Replace `<locale>` with your language code (e.g., `fr`, `de`, `es`).

## Contributors

SuperSplat is made possible by our amazing open source community:

<a href="https://github.com/playcanvas/supersplat/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=playcanvas/supersplat" />
</a>
