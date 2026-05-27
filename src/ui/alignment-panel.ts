import { Button, Container, Label, SelectInput } from '@playcanvas/pcui';

import { AlignmentManager, AlignmentPair } from '../alignment';
import { ElementType } from '../element';
import { Events } from '../events';
import { Scene } from '../scene';
import { Splat } from '../splat';
import { localize } from './localization';

const fmt = (v: number) => Number.isFinite(v) ? v.toFixed(4) : '-';
const fmtPoint = (point?: { position: { x: number, y: number, z: number } }) => {
    return point ? `${fmt(point.position.x)}, ${fmt(point.position.y)}, ${fmt(point.position.z)}` : '-';
};

class AlignmentPanel extends Container {
    constructor(events: Events, scene: Scene, manager: AlignmentManager, args = {}) {
        args = {
            ...args,
            id: 'alignment-panel',
            class: 'panel',
            hidden: true
        };

        super(args);

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((name) => {
            this.dom.addEventListener(name, (e: Event) => e.stopPropagation());
        });

        const header = new Container({ class: 'panel-header' });
        const headerIcon = new Label({ text: 'A', class: 'panel-header-icon' });
        const headerLabel = new Label({
            text: localize('panel.alignment'),
            class: 'panel-header-label'
        });
        const spacer = new Label({ class: 'panel-header-spacer' });
        const closeBtn = new Label({ text: 'X', class: 'panel-header-button' });
        header.append(headerIcon);
        header.append(headerLabel);
        header.append(spacer);
        header.append(closeBtn);
        this.append(header);

        const controls = new Container({ class: 'alignment-controls' });
        const sourceSelect = new SelectInput({ class: 'alignment-select', type: 'number', allowNull: true });
        const targetSelect = new SelectInput({ class: 'alignment-select', type: 'number', allowNull: true });
        const modeSelect = new SelectInput({
            class: 'alignment-select',
            options: [
                { v: 'rigid', t: 'Rigid' },
                { v: 'similarity', t: 'Similarity' }
            ],
            value: 'similarity'
        });

        const sourceRow = new Container({ class: 'alignment-control-row' });
        sourceRow.append(new Label({ text: 'Source', class: 'alignment-control-label' }));
        sourceRow.append(sourceSelect);
        controls.append(sourceRow);

        const targetRow = new Container({ class: 'alignment-control-row' });
        targetRow.append(new Label({ text: 'Target', class: 'alignment-control-label' }));
        targetRow.append(targetSelect);
        controls.append(targetRow);

        const modeRow = new Container({ class: 'alignment-control-row' });
        modeRow.append(new Label({ text: 'Mode', class: 'alignment-control-label' }));
        modeRow.append(modeSelect);
        controls.append(modeRow);

        this.append(controls);

        const pickRow = new Container({ class: 'alignment-button-row' });
        const pickSourceBtn = new Button({ text: 'Pick Source', class: 'alignment-button' });
        const pickTargetBtn = new Button({ text: 'Pick Target', class: 'alignment-button' });
        const swapBtn = new Button({ text: 'Swap', class: 'alignment-button' });
        const clearBtn = new Button({ text: 'Clear', class: 'alignment-button' });
        pickRow.append(pickSourceBtn);
        pickRow.append(pickTargetBtn);
        pickRow.append(swapBtn);
        pickRow.append(clearBtn);
        this.append(pickRow);

        const tableOuter = new Container({ id: 'alignment-pair-list-outer' });
        const table = document.createElement('table');
        table.id = 'alignment-pair-list';
        table.innerHTML = '<thead><tr><th>#</th><th>Source</th><th>Target</th><th>Error</th><th></th></tr></thead>';
        const tbody = document.createElement('tbody');
        table.appendChild(tbody);
        tableOuter.dom.appendChild(table);
        this.append(tableOuter);

        const resultRow = new Container({ class: 'alignment-result-row' });
        const pairCount = new Label({ text: 'Pairs: 0/4', class: 'alignment-result-label' });
        const rmsLabel = new Label({ text: 'RMS: -', class: 'alignment-result-label' });
        resultRow.append(pairCount);
        resultRow.append(rmsLabel);
        this.append(resultRow);

        const actionRow = new Container({ class: 'alignment-button-row' });
        const previewBtn = new Button({ text: 'Preview', class: 'alignment-button' });
        const applyBtn = new Button({ text: 'Align', class: 'alignment-button' });
        actionRow.append(previewBtn);
        actionRow.append(applyBtn);
        this.append(actionRow);

        const splatName = (splat: Splat) => {
            const name = splat.name || (splat.asset.file as any)?.filename || `Splat ${splat.uid}`;
            return `${splat.uid}: ${name}`;
        };

        const splats = () => scene.getElementsByType(ElementType.splat) as Splat[];
        const byUid = (uid: number) => splats().find(splat => splat.uid === uid) ?? null;

        const updateSplatOptions = () => {
            const options = splats().map(splat => ({ v: splat.uid, t: splatName(splat) }));
            sourceSelect.options = options;
            targetSelect.options = options;

            if (!manager.source && options.length > 0) {
                manager.setSource(byUid(options[0].v as number));
            }
            if (!manager.target && options.length > 1) {
                manager.setTarget(byUid(options[1].v as number));
            }

            sourceSelect.value = manager.source?.uid ?? null;
            targetSelect.value = manager.target?.uid ?? null;
        };

        const residualForPair = (pair: AlignmentPair) => {
            const complete = manager.completePairs();
            const index = complete.indexOf(pair);
            return index >= 0 ? manager.lastResult?.residuals[index] : null;
        };

        const rebuildPairs = () => {
            while (tbody.firstChild) {
                tbody.removeChild(tbody.firstChild);
            }

            manager.pairs.forEach((pair, index) => {
                const row = document.createElement('tr');
                const residual = residualForPair(pair);
                row.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${fmtPoint(pair.source)}</td>
                    <td>${fmtPoint(pair.target)}</td>
                    <td>${residual === null || residual === undefined ? '-' : fmt(residual)}</td>
                    <td class="alignment-row-actions"></td>
                `;

                const actions = row.querySelector('.alignment-row-actions') as HTMLElement;
                const up = document.createElement('button');
                up.textContent = '^';
                up.disabled = index === 0;
                up.addEventListener('click', () => manager.movePair(pair.id, -1));
                const down = document.createElement('button');
                down.textContent = 'v';
                down.disabled = index === manager.pairs.length - 1;
                down.addEventListener('click', () => manager.movePair(pair.id, 1));
                const del = document.createElement('button');
                del.textContent = 'x';
                del.addEventListener('click', () => manager.deletePair(pair.id));
                actions.appendChild(up);
                actions.appendChild(down);
                actions.appendChild(del);
                tbody.appendChild(row);
            });
        };

        const update = () => {
            updateSplatOptions();
            rebuildPairs();
            const completeCount = manager.completePairs().length;
            pairCount.text = `Pairs: ${completeCount}/4`;
            rmsLabel.text = `RMS: ${manager.lastResult ? fmt(manager.lastResult.rms) : '-'}`;
            previewBtn.text = manager.previewActive ? 'Revert Preview' : 'Preview';
            previewBtn.enabled = !!manager.lastResult || manager.previewActive;
            applyBtn.enabled = !!manager.lastResult || manager.previewActive;
            pickSourceBtn.class[manager.pickSide === 'source' ? 'add' : 'remove']('active');
            pickTargetBtn.class[manager.pickSide === 'target' ? 'add' : 'remove']('active');
        };

        sourceSelect.on('change', (value: number) => manager.setSource(byUid(value)));
        targetSelect.on('change', (value: number) => manager.setTarget(byUid(value)));
        modeSelect.on('change', (value: 'rigid' | 'similarity') => manager.setMode(value));
        pickSourceBtn.dom.addEventListener('click', () => manager.setPickSide('source'));
        pickTargetBtn.dom.addEventListener('click', () => manager.setPickSide('target'));
        swapBtn.dom.addEventListener('click', () => manager.swapSourceTarget());
        clearBtn.dom.addEventListener('click', () => manager.clearPairs());
        previewBtn.dom.addEventListener('click', () => {
            if (manager.previewActive) {
                manager.revertPreview();
                manager.lastResult = manager.solve();
                events.fire('alignment.changed');
            } else {
                manager.preview();
            }
        });
        applyBtn.dom.addEventListener('click', () => manager.apply());
        closeBtn.dom.addEventListener('click', () => events.fire('tool.deactivate'));

        events.on('alignment.active', (active: boolean) => {
            this.hidden = !active;
            update();
        });
        events.on('alignment.changed', update);
        events.on('scene.elementAdded', update);
        events.on('scene.elementRemoved', update);
        events.on('splat.name', update);

        update();
    }
}

export { AlignmentPanel };
