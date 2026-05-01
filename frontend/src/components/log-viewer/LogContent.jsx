import { forwardRef, useMemo } from 'react';
import { severityOf, splitOnMatch } from './logHelpers';

const LogContent = forwardRef(function LogContent({
    content,
    loading,
    emptyMessage,
    showLineNumbers,
    wrapLines,
    searchPattern,
}, ref) {
    const lines = useMemo(() => {
        if (!content) return [];
        return content.split('\n');
    }, [content]);

    if (loading) {
        return <div className="lv-content lv-content-loading">Loading log…</div>;
    }

    if (!content) {
        return (
            <div className="lv-content lv-content-empty">
                <p>{emptyMessage || 'Select a log file to view its contents.'}</p>
            </div>
        );
    }

    return (
        <div
            ref={ref}
            className={`lv-content ${wrapLines ? 'wrap' : 'nowrap'} ${showLineNumbers ? 'with-line-numbers' : ''}`}
        >
            <div className="lv-lines" role="presentation">
                {lines.map((line, idx) => {
                    const sev = severityOf(line);
                    const segments = searchPattern ? splitOnMatch(line, searchPattern) : null;
                    return (
                        <div key={idx} className={`lv-line ${sev ? `sev-${sev}` : ''}`}>
                            {showLineNumbers && (
                                <span className="lv-line-no">{idx + 1}</span>
                            )}
                            <span className="lv-line-text">
                                {segments
                                    ? segments.map((seg, i) =>
                                          seg.match ? (
                                              <mark key={i} className="lv-match">{seg.text}</mark>
                                          ) : (
                                              <span key={i}>{seg.text}</span>
                                          )
                                      )
                                    : (line || ' ')}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

export default LogContent;
