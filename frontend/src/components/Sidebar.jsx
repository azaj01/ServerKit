import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Star, Settings, LogOut, Sun, Moon, Monitor, ChevronRight, ChevronDown, ChevronUp, Layers, Palette, PanelLeft, Check } from 'lucide-react';
import { api } from '../services/api';
import ServerKitLogo from './ServerKitLogo';
import { SIDEBAR_CATEGORIES, CATEGORY_LABELS, SIDEBAR_PRESETS, getHiddenItemIds, getVisibleItems } from './sidebarItems';
import { useContributions } from '../plugins/contributions';

const Sidebar = () => {
    const { user, logout, updateUser } = useAuth();
    const { theme, resolvedTheme, setTheme, whiteLabel } = useTheme();
    const navigate = useNavigate();
    const [starAnimating, setStarAnimating] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [wpInstalled, setWpInstalled] = useState(false);
    const menuRef = useRef(null);

    // Close menu when clicking outside
    useEffect(() => {
        if (!menuOpen) return;
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [menuOpen]);

    // Check if WordPress is installed
    useEffect(() => {
        api.getWordPressStatus()
            .then(data => setWpInstalled(!!data?.installed))
            .catch(() => setWpInstalled(false));
    }, []);

    useEffect(() => {
        if (whiteLabel.enabled) return;

        let playCount = 0;
        let timeoutId;

        const triggerAnimation = () => {
            setStarAnimating(true);
            setTimeout(() => setStarAnimating(false), 1500);
            playCount++;
        };

        const scheduleNext = () => {
            const multiplier = playCount + 1;
            const minMinutes = 8 * multiplier;
            const maxMinutes = 11 * multiplier;
            const delay = (Math.random() * (maxMinutes - minMinutes) + minMinutes) * 60 * 1000;

            timeoutId = setTimeout(() => {
                triggerAnimation();
                scheduleNext();
            }, delay);
        };

        const initialDelay = setTimeout(() => {
            triggerAnimation();
            scheduleNext();
        }, 60000);

        return () => {
            clearTimeout(initialDelay);
            clearTimeout(timeoutId);
        };
    }, [whiteLabel.enabled]);

    const conditions = { wpInstalled };
    const currentPreset = user?.sidebar_config?.preset || 'full';
    const [manualExpanded, setManualExpanded] = useState({});
    const [autoExpanded, setAutoExpanded] = useState(null);
    const location = useLocation();

    const toggleExpand = (itemId) => {
        const currentlyExpanded = manualExpanded[itemId] ?? (autoExpanded === itemId);
        setManualExpanded(prev => ({ ...prev, [itemId]: !currentlyExpanded }));
    };

    const handlePresetSwitch = (presetKey) => {
        if (presetKey === currentPreset) return;
        const config = { preset: presetKey, hiddenItems: [] };
        // Update locally first (instant), persist to backend in background
        updateUser({ sidebar_config: config });
        api.updateCurrentUser({ sidebar_config: config }).catch(() => {});
    };

    const { nav: pluginNav } = useContributions();

    const visibleItems = useMemo(() => {
        const core = getVisibleItems(user?.sidebar_config);
        const hiddenIds = getHiddenItemIds(user?.sidebar_config);
        // Merge contributed nav items, dedup by id (core wins). Plugins
        // can claim a category; default to 'system' so they always land
        // somewhere visible.
        const existingIds = new Set(core.map((i) => i.id));
        const fromPlugins = (pluginNav || [])
            .filter((item) => (
                item && item.id && item.route
                && !existingIds.has(item.id)
                && !hiddenIds.has(item.id)
            ))
            .map((item) => ({
                ...item,
                category: item.category || 'system',
            }));
        return [...core, ...fromPlugins];
    }, [user?.sidebar_config, pluginNav]);

    // Group visible items by category
    const groupedItems = useMemo(() => {
        const groups = {};
        for (const cat of SIDEBAR_CATEGORIES) {
            const items = visibleItems.filter(item => item.category === cat);
            if (items.length > 0) {
                groups[cat] = items;
            }
        }
        return groups;
    }, [visibleItems]);

    // Auto-expand the active parent (or parent of active sub-item), auto-close others
    useEffect(() => {
        const path = location.pathname;
        let activeParent = null;
        for (const item of visibleItems) {
            if (!item.subItems?.length) continue;
            // Expand if on the parent route itself or any sub-item route
            if (path === item.route || path.startsWith(item.route + '/') ||
                item.subItems.some(sub => path === sub.route || path.startsWith(sub.route + '/'))) {
                activeParent = item.id;
                break;
            }
        }
        setAutoExpanded(activeParent);
        setManualExpanded({});
    }, [location.pathname, visibleItems]);

    const renderNavItem = (item) => {
        const hasChildren = item.subItems && item.subItems.length > 0;
        // Show expanded if manually toggled OR auto-expanded by active route
        const isExpanded = manualExpanded[item.id] ?? (autoExpanded === item.id);
        const visibleSubs = hasChildren
            ? item.subItems.filter(sub => !sub.requiresCondition || conditions[sub.requiresCondition])
            : [];

        return (
            <React.Fragment key={item.id}>
                <div className={`nav-item-row ${hasChildren ? 'has-children' : ''}`}>
                    <NavLink
                        to={item.route}
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        end={item.end || hasChildren}
                    >
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            dangerouslySetInnerHTML={{ __html: item.icon }}
                        />
                        {item.label}
                    </NavLink>
                    {visibleSubs.length > 0 && (
                        <button
                            className={`nav-expand-btn ${isExpanded ? 'expanded' : ''}`}
                            onClick={(e) => { e.stopPropagation(); toggleExpand(item.id); }}
                        >
                            <ChevronRight size={14} />
                        </button>
                    )}
                </div>
                {isExpanded && visibleSubs.map(sub => (
                    <NavLink
                        key={sub.id}
                        to={sub.route}
                        className={({ isActive }) => `nav-item nav-sub-item ${isActive ? 'active' : ''}`}
                    >
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            dangerouslySetInnerHTML={{ __html: sub.icon }}
                        />
                        {sub.label}
                    </NavLink>
                ))}
            </React.Fragment>
        );
    };

    return (
        <aside className="sidebar">
            {whiteLabel.enabled ? (
                <div className="brand-section brand-section--custom">
                    {whiteLabel.mode === 'image_full' ? (
                        <div className="brand-custom-banner">
                            {whiteLabel.logoData ? (
                                <img src={whiteLabel.logoData} alt={whiteLabel.brandName || 'Brand'} />
                            ) : (
                                <Layers size={32} />
                            )}
                        </div>
                    ) : whiteLabel.mode === 'text_only' ? (
                        <span className="brand-custom-text">
                            {whiteLabel.brandName || 'Brand'}
                        </span>
                    ) : (
                        <>
                            <div className="brand-custom-logo">
                                {whiteLabel.logoData ? (
                                    <img src={whiteLabel.logoData} alt={whiteLabel.brandName || 'Brand'} />
                                ) : (
                                    <Layers size={20} />
                                )}
                            </div>
                            <span className="brand-custom-text">
                                {whiteLabel.brandName || 'Brand'}
                            </span>
                        </>
                    )}
                </div>
            ) : (
                <div className="brand-section">
                    <div className="brand-logo">
                        <ServerKitLogo width={42} height={42} />
                    </div>
                    <span className="brand-text">ServerKit</span>
                    <a
                        href="https://github.com/jhd3197/ServerKit"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`brand-star ${starAnimating ? 'animating' : ''}`}
                        title="Star on GitHub"
                    >
                        <Star size={14} />
                        <span className="star-particles">
                            <span></span><span></span><span></span><span></span><span></span><span></span>
                        </span>
                        <span className="star-ring"></span>
                        <span className="star-ring ring-2"></span>
                        <span className="star-ring ring-3"></span>
                        <span className="star-tooltip">Star us!</span>
                    </a>
                </div>
            )}

            <div className="nav-scroll">
                {SIDEBAR_CATEGORIES.map(cat => {
                    const items = groupedItems[cat];
                    if (!items) return null;
                    return (
                        <React.Fragment key={cat}>
                            <div className="nav-category">{CATEGORY_LABELS[cat]}</div>
                            <nav className="nav">
                                {items.map(renderNavItem)}
                            </nav>
                        </React.Fragment>
                    );
                })}
            </div>

            {import.meta.env.DEV && (
                <>
                    <div className="nav-category nav-category--dev">Dev Tools</div>
                    <nav className="nav">
                        <NavLink
                            to="/app-map"
                            className={({ isActive }) => `nav-item nav-item--dev ${isActive ? 'active' : ''}`}
                        >
                            <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                                <line x1="8" y1="2" x2="8" y2="18"/>
                                <line x1="16" y1="6" x2="16" y2="22"/>
                            </svg>
                            App Map
                        </NavLink>
                        <NavLink
                            to="/documentation"
                            className={({ isActive }) => `nav-item nav-item--dev ${isActive ? 'active' : ''}`}
                        >
                            <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                            </svg>
                            Documentation
                        </NavLink>
                        <NavLink
                            to="/style-guide"
                            className={({ isActive }) => `nav-item nav-item--dev ${isActive ? 'active' : ''}`}
                        >
                            <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <circle cx="13.5" cy="6.5" r="2.5"/><path d="M17 2H7a5 5 0 0 0-5 5v10a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5V7a5 5 0 0 0-5-5z"/><path d="M9.5 14.5l-3 3"/><path d="M14.5 9.5l3-3"/>
                            </svg>
                            Style Guide
                        </NavLink>
                    </nav>
                </>
            )}

            <div className="sidebar-footer" ref={menuRef}>
                {menuOpen && (
                    <div className="user-context-menu">
                        <div className="context-menu-section">
                            <div className="context-menu-label">Theme</div>
                            <div className="theme-switcher">
                                <button
                                    className={`theme-btn ${theme === 'dark' ? 'active' : ''}`}
                                    onClick={() => setTheme('dark')}
                                    title="Dark"
                                >
                                    <Moon size={14} />
                                </button>
                                <button
                                    className={`theme-btn ${theme === 'light' ? 'active' : ''}`}
                                    onClick={() => setTheme('light')}
                                    title="Light"
                                >
                                    <Sun size={14} />
                                </button>
                                <button
                                    className={`theme-btn ${theme === 'system' ? 'active' : ''}`}
                                    onClick={() => setTheme('system')}
                                    title="System"
                                >
                                    <Monitor size={14} />
                                </button>
                            </div>
                        </div>
                        <div className="context-menu-section">
                            <div className="context-menu-label">Sidebar View</div>
                            <div className="view-switcher">
                                {Object.entries(SIDEBAR_PRESETS).map(([key, preset]) => (
                                    <button
                                        key={key}
                                        className={`view-btn ${currentPreset === key ? 'active' : ''}`}
                                        onClick={() => handlePresetSwitch(key)}
                                        title={preset.description}
                                    >
                                        {preset.label}
                                        {currentPreset === key && <Check size={10} />}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="context-menu-divider" />
                        <button
                            className="context-menu-item"
                            onClick={() => { navigate('/settings/appearance'); setMenuOpen(false); }}
                        >
                            <Palette size={15} />
                            Appearance
                            <ChevronRight size={14} className="context-menu-arrow" />
                        </button>
                        <button
                            className="context-menu-item"
                            onClick={() => { navigate('/settings/sidebar'); setMenuOpen(false); }}
                        >
                            <PanelLeft size={15} />
                            Customize Sidebar
                            <ChevronRight size={14} className="context-menu-arrow" />
                        </button>
                        <button
                            className="context-menu-item"
                            onClick={() => { navigate('/settings'); setMenuOpen(false); }}
                        >
                            <Settings size={15} />
                            All Settings
                            <ChevronRight size={14} className="context-menu-arrow" />
                        </button>
                        <div className="context-menu-divider" />
                        <button className="context-menu-item danger" onClick={logout}>
                            <LogOut size={15} />
                            Log out
                        </button>
                    </div>
                )}
                <div className="user-mini" onClick={() => setMenuOpen(!menuOpen)}>
                    <div className="user-avatar">
                        {user?.username?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div className="user-meta">
                        <span className="user-handle">{user?.username || 'User'}</span>
                        <span className="user-status">Online</span>
                    </div>
                    <ChevronUp size={14} className={`user-menu-arrow ${menuOpen ? 'open' : ''}`} />
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
