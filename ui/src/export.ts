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



export const serializeExport = (notes: Array<Notebook>): string =>
    JSON.stringify({ version: EXPORT_FORMAT_VERSION, notes })

const _exportNotes = (fileName:string, notes: Array<Notebook>) => {
    download(fileName, serializeExport(notes))
}

/**
 * A workspace's text as written by any release. v0.0.11 wrote the whole note
 * state (`{ text: "..." }`, Automerge 1's Text serialized as a string); every
 * later release writes the text itself. The character-list and `body` shapes
 * are accepted too, in case a state object turns up from elsewhere.
 */
export const noteTextFromExport = (note: unknown): string => {
    if (typeof note === "string") return note
    if (note && typeof note === "object") {
        const n = note as { text?: unknown; body?: unknown }
        if (typeof n.body === "string") return n.body
        if (typeof n.text === "string") return n.text
        if (Array.isArray(n.text)) return n.text.join("")
    }
    return ""
}

export const exportNote = (state: Notebook) => {
    const fileName = sanitize(`${PREFIX}_export_${state.meta.title}.json`)
    _exportNotes(fileName, [state])
}

export const exportNotes = (notebooks: Array<Notebook>) => {
    const date = new Date();
    const formattedDate = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-`
        + date.getHours() + "_" + ("00" + date.getMinutes()).slice(-2) +"_"+ ("00" + date.getSeconds()).slice(-2)

    const fileName = sanitize(`${PREFIX}_export_${formattedDate}.json`)
    _exportNotes(fileName, notebooks)
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