import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

// Self-contained search box: an icon + debounced text input. Keeps its own
// internal text state and only lifts the (debounced) value up via onSearch, so
// it can be hosted anywhere — including a re-published PageTopbar action node —
// without losing focus between keystrokes. Reusable across any table/list.
export function SearchField({
    value = '',
    onSearch,
    placeholder = 'Search…',
    debounce = 200,
    className,
}) {
    const [text, setText] = useState(value);
    const timer = useRef(null);

    // Sync when the parent resets/changes the value programmatically (e.g. a
    // "Reset filters" action). Typing keeps text ahead of the debounced value,
    // and setting to an equal string is a no-op, so this won't fight the user.
    useEffect(() => { setText(value); }, [value]);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const handleChange = (next) => {
        setText(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onSearch?.(next), debounce);
    };

    return (
        <div className={cn('sk-searchfield', className)}>
            <Search className="sk-searchfield__icon" aria-hidden="true" />
            <input
                type="search"
                className="sk-searchfield__input"
                placeholder={placeholder}
                value={text}
                onChange={(event) => handleChange(event.target.value)}
                aria-label={placeholder}
            />
        </div>
    );
}

export default SearchField;
