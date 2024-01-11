import sanitize from "sanitize-filename";
import { Notebook } from "./types";

const EXPORT_FORMAT_VERSION = "1"
const PREFIX = "notebooks"
const download = (filename: string, text: string) => {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/json;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);

    element.style.display = 'none';
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
}

const _exportNotes = (fileName:string, notes: Array<Notebook>) => {
    const exportObject = {
        version: EXPORT_FORMAT_VERSION,
        notes,
    }
    download(fileName, JSON.stringify(exportObject))
}

export const exportNote = (state: Notebook) => {
    const fileName = sanitize(`${PREFIX}_export_${state.meta.title}.json`)
    _exportNotes(fileName, [state])
    alert(`Your board was exported to your Downloads folder as: '${fileName}'`)
}

export const exportNotes = (notebooks: Array<Notebook>) => {
    const date = new Date();
    const formattedDate = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-`
        + date.getHours() + "_" + ("00" + date.getMinutes()).slice(-2) +"_"+ ("00" + date.getSeconds()).slice(-2)

    const fileName = sanitize(`${PREFIX}_export_${formattedDate}.json`)
    _exportNotes(fileName, notebooks)
    alert(`Exported to your Downloads folder as: '${fileName}'`)
}

export const deserializeExport = (jsonExport:string) : Array<Notebook> => {
    try {
        const exportObject = JSON.parse(jsonExport)
        if (!exportObject.version) {
            throw( new Error("Expected export to have a version number"))
        }
        return exportObject.notes

    } catch (e) {
        console.log("Error importing notebooks:", e)
        return []
    }
}