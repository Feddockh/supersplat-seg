import { Button, ColorPicker, Container, Label, NumericInput, TextInput } from '@playcanvas/pcui';

import { Events } from '../events';
import { SemanticClass, SemanticLabelManager } from '../semantic-labels';
import { localize } from './localization';

const rgb = (color: [number, number, number]) => {
    return `rgb(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)})`;
};

class AnnotationPanel extends Container {
    constructor(events: Events, manager: SemanticLabelManager, args = {}) {
        args = {
            ...args,
            id: 'annotation-panel',
            class: ['panel', 'semantic-panel'],
            hidden: true
        };

        super(args);

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((name) => {
            this.dom.addEventListener(name, (e: Event) => e.stopPropagation());
        });

        const header = new Container({ class: 'panel-header' });
        const headerIcon = new Label({ text: 'S', class: 'panel-header-icon' });
        const headerLabel = new Label({
            text: localize('panel.annotation'),
            class: 'panel-header-label'
        });
        const spacer = new Label({ class: 'panel-header-spacer' });
        const closeBtn = new Label({ text: 'X', class: 'panel-header-button' });
        header.append(headerIcon);
        header.append(headerLabel);
        header.append(spacer);
        header.append(closeBtn);
        this.append(header);

        const topControls = new Container({ class: 'semantic-top-controls' });
        const addClassBtn = new Button({ text: localize('annotation.add-class'), class: 'semantic-button' });
        const assignBtn = new Button({ text: 'Assign Selection', class: 'semantic-button' });
        const clearSelectionBtn = new Button({ text: 'Clear Selection', class: 'semantic-button' });
        topControls.append(addClassBtn);
        topControls.append(assignBtn);
        topControls.append(clearSelectionBtn);
        this.append(topControls);

        const overlayRow = new Container({ class: 'semantic-overlay-row' });
        const overlayBtn = new Button({ text: 'Overlay On', class: 'semantic-button' });
        const alphaLabel = new Label({ text: 'Opacity', class: 'semantic-label' });
        const alphaInput = new NumericInput({
            min: 0,
            max: 1,
            precision: 2,
            step: 0.05,
            value: manager.overlayAlpha,
            width: 64
        });
        overlayRow.append(overlayBtn);
        overlayRow.append(alphaLabel);
        overlayRow.append(alphaInput);
        this.append(overlayRow);

        const classListOuter = new Container({ id: 'annotation-class-list-outer' });
        const classList = new Container({ id: 'annotation-class-list' });
        classListOuter.append(classList);
        this.append(classListOuter);

        const exportBtn = new Button({ id: 'annotation-export-centroids', text: 'Export Centroids JSON' });
        this.append(exportBtn);

        const rebuildClassList = () => {
            while (classList.dom.firstChild) {
                classList.dom.removeChild(classList.dom.firstChild);
            }

            for (const cls of manager.classes.values()) {
                const row = new Container({ class: ['annotation-class-row', 'semantic-class-row'] });
                if (manager.activeClassId === cls.id) row.dom.classList.add('active');

                const swatch = new Container({ class: 'annotation-class-swatch' });
                swatch.dom.style.backgroundColor = rgb(cls.color);

                const nameInput = new TextInput({
                    class: 'annotation-class-name',
                    value: cls.name
                });

                const colorPicker = new ColorPicker({
                    class: 'annotation-class-color',
                    channels: 3,
                    value: [...cls.color]
                });

                const visibleBtn = new Button({
                    class: 'semantic-icon-button',
                    text: cls.visible ? 'Show' : 'Hide'
                });

                const selectBtn = new Button({
                    class: 'semantic-icon-button',
                    text: 'Select'
                });

                const deleteClassBtn = new Button({
                    class: 'semantic-icon-button',
                    text: 'Del'
                });

                row.append(swatch);
                row.append(nameInput);
                row.append(colorPicker);
                row.append(visibleBtn);
                row.append(selectBtn);
                row.append(deleteClassBtn);
                classList.append(row);

                row.dom.addEventListener('click', (e: Event) => {
                    if (e.target === nameInput.dom || nameInput.dom.contains(e.target as Node)) return;
                    if (e.target === colorPicker.dom || colorPicker.dom.contains(e.target as Node)) return;
                    if ((e.target as HTMLElement).closest('button')) return;
                    manager.setActiveClass(cls.id);
                });

                nameInput.on('change', (value: string) => {
                    manager.updateClass(cls.id, { name: value });
                });

                colorPicker.on('change', (value: number[]) => {
                    const color: [number, number, number] = [value[0], value[1], value[2]];
                    manager.updateClass(cls.id, { color });
                    swatch.dom.style.backgroundColor = rgb(color);
                });

                visibleBtn.dom.addEventListener('click', () => {
                    manager.updateClass(cls.id, { visible: !cls.visible });
                });

                selectBtn.dom.addEventListener('click', () => {
                    manager.selectClass(cls.id);
                });

                deleteClassBtn.dom.addEventListener('click', () => {
                    manager.deleteClass(cls.id);
                });
            }
        };

        const update = () => {
            overlayBtn.text = manager.overlayEnabled ? 'Overlay On' : 'Overlay Off';
            rebuildClassList();
        };

        closeBtn.dom.addEventListener('click', () => {
            events.fire('tool.deactivate');
        });

        addClassBtn.dom.addEventListener('click', () => {
            manager.addClass();
        });

        assignBtn.dom.addEventListener('click', () => {
            manager.assignSelection();
        });

        clearSelectionBtn.dom.addEventListener('click', () => {
            manager.clearSelection();
        });

        overlayBtn.dom.addEventListener('click', () => {
            manager.setOverlay(!manager.overlayEnabled);
        });

        alphaInput.on('change', (value: number) => {
            manager.setOverlayAlpha(value);
        });

        exportBtn.dom.addEventListener('click', async () => {
            await events.invoke('annotation.exportCentroids');
        });

        events.on('annotation.active', (active: boolean) => {
            this.hidden = !active;
            update();
        });
        events.on('semantic.changed', update);

        update();
    }
}

export { AnnotationPanel };
