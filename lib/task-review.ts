/**
 * Does a project task this viewer submits wait for the owner to accept it? Not when the
 * project auto-accepts, has no owner, or the viewer could accept it themselves.
 */
export function awaitsOwnerReview(
  project: { autoAcceptTasks: boolean; ownerId: number | null },
  viewerCanManage: boolean,
): boolean {
  return !project.autoAcceptTasks && project.ownerId !== null && !viewerCanManage
}
