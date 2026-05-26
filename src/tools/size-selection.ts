import { Button, Container, NumericInput } from '@playcanvas/pcui';

import { Events } from '../events';

class SizeSelection {
    activate: () => void;
    deactivate: () => void;

    constructor(events: Events, canvasContainer: Container) {
        const selectToolbar = new Container({
            class: 'select-toolbar',
            hidden: true
        });

        selectToolbar.dom.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });

        const setButton = new Button({ text: 'Select', class: 'select-toolbar-button' });
        const addButton = new Button({ text: 'Add', class: 'select-toolbar-button' });
        const removeButton = new Button({ text: 'Remove', class: 'select-toolbar-button' });
        const threshold = new NumericInput({
            precision: 4,
            value: 0.01,
            placeholder: 'Threshold',
            width: 100,
            min: 0
        });

        selectToolbar.append(threshold);
        selectToolbar.append(setButton);
        selectToolbar.append(addButton);
        selectToolbar.append(removeButton);

        canvasContainer.append(selectToolbar);

        const apply = (op: 'set' | 'add' | 'remove') => {
            events.fire('select.sizeBelow', op, threshold.value ?? 0.01);
        };

        setButton.dom.addEventListener('pointerdown', (e) => { e.stopPropagation(); apply('set'); });
        addButton.dom.addEventListener('pointerdown', (e) => { e.stopPropagation(); apply('add'); });
        removeButton.dom.addEventListener('pointerdown', (e) => { e.stopPropagation(); apply('remove'); });

        this.activate = () => {
            selectToolbar.hidden = false;
        };

        this.deactivate = () => {
            selectToolbar.hidden = true;
        };
    }
}

export { SizeSelection };
