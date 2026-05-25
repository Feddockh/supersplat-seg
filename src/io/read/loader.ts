/**
 * Unified loader for all splat file formats using splat-transform.
 */

import {
    getInputFormat,
    readFile,
    sortMortonOrder,
    Column,
    ColumnType,
    DataTable,
    Options,
    ReadFileSystem,
    Transform,
    ZipReadFileSystem
} from '@playcanvas/splat-transform';
import { GSplatData } from 'playcanvas';

type LoadResult = {
    gsplatData: GSplatData;
    transform: Transform;
};

type NumericArray =
    Int8Array | Uint8Array | Int16Array | Uint16Array |
    Int32Array | Uint32Array | Float32Array | Float64Array;

type PlyProperty = {
    name: string;
    type: string;
};

type PlyElement = {
    name: string;
    count: number;
    properties: PlyProperty[];
};

const REQUIRED_GAUSSIAN_PROPS = [
    'x', 'y', 'z',
    'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3',
    'f_dc_0', 'f_dc_1', 'f_dc_2',
    'opacity'
];

/**
 * Default options for readFile.
 */
const defaultOptions: Options = {
    iterations: 10,
    lodSelect: [0],
    unbundled: false,
    lodChunkCount: 512,
    lodChunkExtent: 16
};

/**
 * Map splat-transform column types to GSplatData property types.
 */
const columnTypeToGSplatType = (colType: ColumnType | null): string => {
    switch (colType) {
        case 'int8': return 'char';
        case 'uint8': return 'uchar';
        case 'int16': return 'short';
        case 'uint16': return 'ushort';
        case 'int32': return 'int';
        case 'uint32': return 'uint';
        case 'float32': return 'float';
        case 'float64': return 'double';
        default: return 'float';
    }
};

const hasProps = (gsplatData: GSplatData, names: string[]) => {
    return names.every(name => !!gsplatData.getProp(name));
};

const hasColumns = (dataTable: DataTable, names: string[]) => {
    return names.every(name => dataTable.columns.some((col: Column) => col.name === name));
};

const firstProp = (gsplatData: GSplatData, names: string[]) => {
    const vertex = gsplatData.getElement('vertex');
    const props = vertex?.properties ?? [];

    for (const name of names) {
        const prop = props.find((prop: any) => prop.name.toLowerCase() === name)?.storage as NumericArray | null;
        if (prop) {
            return prop;
        }
    }
    return null;
};

const normalizeColorChannel = (prop: NumericArray, index: number) => {
    const value = prop[index];
    let normalized: number;

    if (prop instanceof Uint8Array) {
        normalized = value / 255;
    } else if (prop instanceof Uint16Array || prop instanceof Uint32Array) {
        normalized = value <= 255 ? value / 255 : value / (Math.pow(2, prop.BYTES_PER_ELEMENT * 8) - 1);
    } else if (prop instanceof Int8Array || prop instanceof Int16Array || prop instanceof Int32Array) {
        const max = Math.pow(2, prop.BYTES_PER_ELEMENT * 8 - 1) - 1;
        normalized = value <= 1 ? value : (value <= 255 ? value / 255 : value / max);
    } else {
        normalized = value > 1 ? value / 255 : value;
    }

    return Math.min(1, Math.max(0, normalized));
};

const colorToDc = (prop: NumericArray | null, index: number) => {
    const C0_INV = 1.0 / 0.28209479177387814;
    const color = prop ? normalizeColorChannel(prop, index) : 0.5;
    return (color - 0.5) * C0_INV;
};

const typedArrayForPlyType = (type: string, count: number): NumericArray => {
    switch (type) {
        case 'char':
        case 'int8': return new Int8Array(count);
        case 'uchar':
        case 'uint8': return new Uint8Array(count);
        case 'short':
        case 'int16': return new Int16Array(count);
        case 'ushort':
        case 'uint16': return new Uint16Array(count);
        case 'int':
        case 'int32': return new Int32Array(count);
        case 'uint':
        case 'uint32': return new Uint32Array(count);
        case 'float':
        case 'float32': return new Float32Array(count);
        case 'double':
        case 'float64': return new Float64Array(count);
        default:
            throw new Error(`Unsupported ASCII PLY property type: ${type}`);
    }
};

const assignAsciiValue = (storage: NumericArray, index: number, value: string) => {
    if (storage instanceof Float32Array || storage instanceof Float64Array) {
        storage[index] = Number.parseFloat(value);
    } else {
        storage[index] = Number.parseInt(value, 10);
    }
};

const findAsciiHeaderEnd = (text: string) => {
    const end = text.indexOf('end_header');
    if (end === -1) {
        return -1;
    }

    let dataStart = end + 'end_header'.length;
    if (text[dataStart] === '\r') {
        dataStart++;
    }
    if (text[dataStart] === '\n') {
        dataStart++;
    }

    return dataStart;
};

const parseAsciiPlyHeader = (headerText: string) => {
    const lines = headerText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    if (lines[0] !== 'ply' || lines[1] !== 'format ascii 1.0') {
        return null;
    }

    const elements: PlyElement[] = [];
    let current: PlyElement | null = null;
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i];
        const words = line.split(/\s+/);

        if (words[0] === 'comment' || words[0] === 'obj_info') {
            continue;
        }

        if (words[0] === 'element') {
            current = {
                name: words[1],
                count: Number.parseInt(words[2], 10),
                properties: []
            };
            elements.push(current);
        } else if (words[0] === 'property') {
            if (!current) {
                throw new Error('Invalid ASCII PLY header: property without element');
            }
            if (words[1] === 'list') {
                current.properties.push({ name: words[4], type: 'list' });
            } else {
                current.properties.push({ name: words[2], type: words[1] });
            }
        }
    }

    return elements;
};

const readAsciiPlyDataTable = async (filename: string, fileSystem: ReadFileSystem): Promise<DataTable | null> => {
    const source = await fileSystem.createSource(filename);
    try {
        const headerStream = source.read(0, Math.min(source.size, 128 * 1024));
        const headerBytes = await headerStream.readAll();
        headerStream.close();

        const headerProbe = new TextDecoder('ascii').decode(headerBytes);
        const dataStart = findAsciiHeaderEnd(headerProbe);
        if (dataStart === -1) {
            throw new Error('Invalid PLY file: missing end_header');
        }

        const elements = parseAsciiPlyHeader(headerProbe.slice(0, dataStart));
        if (!elements) {
            return null;
        }

        const vertexElement = elements.find(element => element.name === 'vertex');
        if (!vertexElement) {
            throw new Error('PLY file does not contain vertex element');
        }
        if (vertexElement.properties.some(prop => prop.type === 'list')) {
            return null;
        }

        const bodyStream = source.read(dataStart, source.size);
        const bodyBytes = await bodyStream.readAll();
        bodyStream.close();

        const columns = vertexElement.properties.map(prop => new Column(prop.name, typedArrayForPlyType(prop.type, vertexElement.count)));
        const lines = new TextDecoder('ascii').decode(bodyBytes).split(/\r?\n/);
        let lineIndex = 0;

        for (const element of elements) {
            const isVertex = element === vertexElement;
            for (let row = 0; row < element.count; row++) {
                while (lineIndex < lines.length && lines[lineIndex].trim().length === 0) {
                    lineIndex++;
                }

                const values = lines[lineIndex++]?.trim().split(/\s+/);
                if (!values || values.length < element.properties.length) {
                    throw new Error(`Invalid ASCII PLY data in element '${element.name}' at row ${row}`);
                }

                if (isVertex) {
                    for (let col = 0; col < columns.length; col++) {
                        assignAsciiValue(columns[col].data as NumericArray, row, values[col]);
                    }
                }
            }
        }

        return new DataTable(columns, Transform.PLY);
    } finally {
        source.close();
    }
};

const addPointCloudSplatProps = (gsplatData: GSplatData) => {
    const hasPosition = hasProps(gsplatData, ['x', 'y', 'z']);
    const hasRequiredSplatProps = hasProps(gsplatData, REQUIRED_GAUSSIAN_PROPS);

    if (!hasPosition || hasRequiredSplatProps) {
        return;
    }

    const n = gsplatData.numSplats;

    // Guard against point clouds large enough to OOM the browser.
    const MAX_POINT_CLOUD_POINTS = 3_000_000;
    if (n > MAX_POINT_CLOUD_POINTS) {
        throw new Error(
            `Point cloud has ${n.toLocaleString()} points, which exceeds the ` +
            `${MAX_POINT_CLOUD_POINTS.toLocaleString()} point limit. ` +
            'Please downsample the file before importing.'
        );
    }

    const xProp = gsplatData.getProp('x') as NumericArray;
    const yProp = gsplatData.getProp('y') as NumericArray;
    const zProp = gsplatData.getProp('z') as NumericArray;

    let defaultScale = Math.log(0.001);

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = xProp[i], y = yProp[i], z = zProp[i];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }

    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    if (Number.isFinite(extent) && extent > 0) {
        const estimatedSpacing = extent / Math.cbrt(Math.max(n, 1));
        const splatSize = Math.min(extent * 0.0012, Math.max(extent * 0.00015, estimatedSpacing * 0.035));
        defaultScale = Math.log(Math.max(splatSize, 1e-6));
    }

    if (!gsplatData.getProp('scale_0')) {
        gsplatData.addProp('scale_0', new Float32Array(n).fill(defaultScale));
    }
    if (!gsplatData.getProp('scale_1')) {
        gsplatData.addProp('scale_1', new Float32Array(n).fill(defaultScale));
    }
    if (!gsplatData.getProp('scale_2')) {
        gsplatData.addProp('scale_2', new Float32Array(n).fill(defaultScale));
    }

    if (!gsplatData.getProp('rot_0')) {
        gsplatData.addProp('rot_0', new Float32Array(n).fill(1));
    }
    if (!gsplatData.getProp('rot_1')) {
        gsplatData.addProp('rot_1', new Float32Array(n));
    }
    if (!gsplatData.getProp('rot_2')) {
        gsplatData.addProp('rot_2', new Float32Array(n));
    }
    if (!gsplatData.getProp('rot_3')) {
        gsplatData.addProp('rot_3', new Float32Array(n));
    }

    const red = firstProp(gsplatData, ['red', 'r', 'diffuse_red']);
    const green = firstProp(gsplatData, ['green', 'g', 'diffuse_green']);
    const blue = firstProp(gsplatData, ['blue', 'b', 'diffuse_blue']);

    const addDcProp = (name: string, colorProp: NumericArray | null) => {
        if (!gsplatData.getProp(name)) {
            const values = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                values[i] = colorToDc(colorProp, i);
            }
            gsplatData.addProp(name, values);
        }
    };

    addDcProp('f_dc_0', red);
    addDcProp('f_dc_1', green);
    addDcProp('f_dc_2', blue);

    if (!gsplatData.getProp('opacity')) {
        gsplatData.addProp('opacity', new Float32Array(n).fill(8));
    }
};

/**
 * Convert a splat-transform DataTable to PlayCanvas GSplatData.
 */
const dataTableToGSplatData = (dataTable: DataTable): GSplatData => {
    const properties = dataTable.columns.map((col: Column) => ({
        type: columnTypeToGSplatType(col.dataType),
        name: col.name,
        storage: col.data,
        byteSize: col.data.BYTES_PER_ELEMENT
    }));

    const gsplatData = new GSplatData([{
        name: 'vertex',
        count: dataTable.numRows,
        properties
    }]);

    const has2DSplatProps = hasProps(gsplatData, [
        'x', 'y', 'z',
        'scale_0', 'scale_1',
        'rot_0', 'rot_1', 'rot_2', 'rot_3',
        'f_dc_0', 'f_dc_1', 'f_dc_2',
        'opacity'
    ]);

    // Support loading 2D splats by adding scale_2 property with almost 0 scale.
    // Partial point clouds go through addPointCloudSplatProps below instead.
    if (has2DSplatProps && !gsplatData.getProp('scale_2')) {
        const scale2 = new Float32Array(gsplatData.numSplats).fill(Math.log(1e-6));
        gsplatData.addProp('scale_2', scale2);

        // Place the new scale_2 property just after scale_1
        const props = gsplatData.getElement('vertex').properties;
        props.splice(props.findIndex((prop: any) => prop.name === 'scale_1') + 1, 0, props.splice(props.length - 1, 1)[0]);
    }

    addPointCloudSplatProps(gsplatData);

    return gsplatData;
};

/**
 * Load a file using splat-transform and convert to GSplatData.
 * @param filename - The filename to load
 * @param fileSystem - The file system to read from
 * @param skipReorder - Skip morton reordering (for files already in morton order or animation playback)
 */
const loadGSplatData = async (filename: string, fileSystem: ReadFileSystem, skipReorder?: boolean): Promise<LoadResult> => {
    const inputFormat = getInputFormat(filename);
    const lowerFilename = filename.toLowerCase();

    // Handle bundled SOG (.sog extension) - wrap with ZipReadFileSystem
    if (inputFormat === 'sog' && lowerFilename.endsWith('.sog')) {
        const source = await fileSystem.createSource(filename);
        const zipFs = new ZipReadFileSystem(source);
        try {
            const tables = await readFile({
                filename: 'meta.json',
                inputFormat: 'sog',
                options: defaultOptions,
                params: [],
                fileSystem: zipFs
            });
            return { gsplatData: dataTableToGSplatData(tables[0]), transform: tables[0].transform };
        } finally {
            zipFs.close();
        }
    }

    let tables: DataTable[];
    const asciiPlyTable = inputFormat === 'ply' ? await readAsciiPlyDataTable(filename, fileSystem) : null;
    if (asciiPlyTable) {
        tables = [asciiPlyTable];
    } else {
        // Read the file using splat-transform
        tables = await readFile({
            filename,
            inputFormat,
            options: defaultOptions,
            params: [],
            fileSystem
        });
    }

    // Reorder data into morton order for better render performance.
    // Skip reordering for:
    // - SOG format (already in morton order)
    // - Compressed PLY (already in morton order from write-compressed-ply)
    // - When skipReorder is true (ssproj files are already ordered, animation frames need speed)
    // - Point clouds or partial splat-like files: sort is O(n log n) and hangs on large clouds
    const isCompressedPly = lowerFilename.endsWith('.compressed.ply');
    const hasRequiredSplatColumns = hasColumns(tables[0], REQUIRED_GAUSSIAN_PROPS);
    if (inputFormat !== 'sog' && !isCompressedPly && !skipReorder && hasRequiredSplatColumns) {
        const indices = new Uint32Array(tables[0].numRows);
        for (let i = 0; i < indices.length; i++) {
            indices[i] = i;
        }
        sortMortonOrder(tables[0], indices);
        tables[0].permuteRowsInPlace(indices);
    }

    // Convert to GSplatData (use first table, as most formats return single table)
    // LCC may return multiple tables for different LOD levels - we use the first (highest detail)
    return { gsplatData: dataTableToGSplatData(tables[0]), transform: tables[0].transform };
};

/**
 * Validate that GSplatData contains required properties.
 */
const validateGSplatData = (gsplatData: GSplatData): void => {
    const required = REQUIRED_GAUSSIAN_PROPS;

    const missing = required.filter(x => !gsplatData.getProp(x));
    if (missing.length > 0) {
        throw new Error(`This file does not contain gaussian splatting data. The following properties are missing: ${missing.join(', ')}`);
    }
};

export {
    loadGSplatData,
    validateGSplatData
};
