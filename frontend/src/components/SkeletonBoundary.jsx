import { Children, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { renderBones } from './renderBones';

/**
 * SkeletonBoundary — paints a loading skeleton over the real content box.
 *
 * Instead of swapping the content tree for a disconnected placeholder (which
 * shifts layout when data arrives), the boundary keeps the real children in
 * flow and, while `loading`, hides them (`visibility: hidden`) and overlays the
 * `skeleton` absolutely (`position: absolute; inset: 0`). The overlay inherits
 * the real content's dimensions, so the skeleton is correct by construction at
 * every breakpoint — zero guessed geometry, zero layout shift.
 *
 *   <SkeletonBoundary loading={isLoading} skeleton={<CertListSkeleton />}>
 *     {status && <CertList data={status} />}
 *   </SkeletonBoundary>
 *
 * When `loading` with no in-flow children yet (first load, data-gated), the
 * boundary renders the skeleton in normal flow at its intrinsic size — the same
 * footprint as a plain skeleton swap, so there's no regression on first paint.
 * Overlay mode kicks in automatically once real children are present (e.g. a
 * refresh over already-loaded data).
 *
 * Accessibility: the boundary is `aria-busy` while loading and the skeleton is
 * `aria-hidden`. Shimmer and the optional fade honour `prefers-reduced-motion`
 * via `styles/components/_skeleton.scss`.
 *
 * A captured bone layout (baked into `frontend/src/skeletons/*.json` by
 * `npm run capture:skeletons`) can be passed as `bones` instead of composing a
 * `skeleton` by hand — the boundary replays it via `renderBones`. `bones` wins
 * over `skeleton` when both are given.
 *
 * @param {boolean}        loading      Whether content is still loading.
 * @param {React.ReactNode} skeleton    Placeholder rendered while loading.
 * @param {object}         [bones]      Captured SkeletonResult (`{width,height,bones}`); replaces `skeleton` when set.
 * @param {React.ReactNode} children    Real content (may be data-gated/absent).
 * @param {boolean}        [transition] Fade the skeleton out on load (~200ms, opacity only).
 * @param {string}         [as]         Container tag name (default 'div').
 * @param {string}         [className]  Extra classes on the boundary container.
 */
export function SkeletonBoundary({
    loading,
    skeleton,
    bones = null,
    children,
    transition = false,
    as: Tag = 'div',
    className = '',
    ...rest
}) {
    // Keep the skeleton mounted through a short fade-out when `transition` is on.
    const [showSkeleton, setShowSkeleton] = useState(loading);
    const leaving = !loading && showSkeleton;

    useEffect(() => {
        if (loading) {
            setShowSkeleton(true);
            return undefined;
        }
        if (!transition) {
            setShowSkeleton(false);
            return undefined;
        }
        const timer = setTimeout(() => setShowSkeleton(false), 200);
        return () => clearTimeout(timer);
    }, [loading, transition]);

    // Overlay mode needs a real box to cover — only when in-flow children exist.
    const hasContent = Children.toArray(children).length > 0;
    const skeletonContent = bones ? renderBones(bones) : skeleton;

    return (
        <Tag
            className={cn('skeleton-boundary', className)}
            data-loading={loading ? 'true' : undefined}
            aria-busy={loading ? 'true' : undefined}
            {...rest}
        >
            {children}
            {showSkeleton && (
                <div
                    className={cn(
                        'skeleton-boundary__skeleton',
                        hasContent && 'skeleton-boundary__skeleton--overlay',
                        transition && 'skeleton-boundary__skeleton--fade',
                        leaving && 'skeleton-boundary__skeleton--leaving',
                    )}
                    aria-hidden="true"
                >
                    {skeletonContent}
                </div>
            )}
        </Tag>
    );
}

export default SkeletonBoundary;
