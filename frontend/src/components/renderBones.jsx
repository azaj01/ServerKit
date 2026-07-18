import { cn } from '@/lib/utils';

/**
 * Replay a captured bone layout (baked into `frontend/src/skeletons/*.json` by
 * `npm run capture:skeletons`) as positioned skeleton placeholders.
 *
 * Bone geometry model (from boneyard-js `snapshotBones`): `x`/`w` are
 * PERCENTAGES of the captured region width, `y`/`h` are ABSOLUTE PIXELS from the
 * region top, and `r` is a number (px) or a CSS string. Container bones
 * (`c: true`) are background surfaces — skipped so only the leaf placeholders
 * paint, matching boneyard's own renderer.
 *
 * The per-bone `left/top/width/height/borderRadius` are true dynamic values
 * (measured, not guessed), which the styling standard permits as inline styles;
 * the shimmer, color, and reduced-motion handling all come from `.skeleton`.
 *
 * @param {{width?:number,height?:number,bones?:Array}|null} snapshot  A captured
 *        SkeletonResult, or null (renders nothing).
 * @returns {JSX.Element|null}
 */
export function renderBones(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.bones)) return null;
    const { height = 0, bones } = snapshot;
    return (
        <div
            className="skeleton-bones"
            style={{ height: height ? `${height}px` : undefined }}
            aria-hidden="true"
        >
            {bones.filter((b) => !b.c).map((b, i) => {
                const isCircle = b.r === '50%';
                const radius = typeof b.r === 'number' ? `${b.r}px` : b.r;
                return (
                    <span
                        key={i}
                        className={cn('skeleton', 'skeleton-bone')}
                        style={{
                            left: `${b.x}%`,
                            top: `${b.y}px`,
                            width: isCircle ? `${b.h}px` : `${b.w}%`,
                            height: `${b.h}px`,
                            borderRadius: radius,
                        }}
                    />
                );
            })}
        </div>
    );
}

export default renderBones;
