import { Events } from '../events';

class SemanticLabelTool {
    activate: () => void;
    deactivate: () => void;

    constructor(events: Events) {
        this.activate = () => {
            events.fire('annotation.active', true);
        };

        this.deactivate = () => {
            events.fire('annotation.active', false);
        };
    }
}

export { SemanticLabelTool };
