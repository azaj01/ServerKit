import { BookOpen } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { docsUrl } from '../utils/docsLinks';

// Small "Docs" link (book icon) that opens a serverkit.ai docs page in a new
// tab. Hidden when White Label branding is active — an operator who rebranded
// the panel does not want it pointing users at serverkit.ai. This is the ONE
// place that rule lives, so wiring more docs links never re-implements it.
export default function DocsLink({ to, label = 'Docs', className = '' }) {
    const { whiteLabel } = useTheme();
    if (whiteLabel?.enabled) return null;

    return (
        <a
            href={docsUrl(to)}
            target="_blank"
            rel="noopener noreferrer"
            className={`sk-docs-link ${className}`.trim()}
        >
            <BookOpen size={14} aria-hidden="true" />
            {label}
        </a>
    );
}
