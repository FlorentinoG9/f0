/**
 * Folder cell type for displaying a folder icon alongside its name.
 * Used for showing folders on items in data collections.
 */
import { Folder } from "@/icons/app"
import { ValueDisplayRendererContext } from "../../renderers"
import { IconCell } from "../icon"

interface FolderValue {
  name: string
}
export type FolderCellValue = FolderValue

export const FolderCell = (
  args: FolderCellValue,
  meta: ValueDisplayRendererContext
) => IconCell({ icon: Folder, label: args.name }, meta)
