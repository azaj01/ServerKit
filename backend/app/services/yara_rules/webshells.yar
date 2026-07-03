/*
    ServerKit curated web-shell / injected-code indicators.

    These rules intentionally use regex atoms (not long literal strings) so
    this rules file itself is unlikely to trip other content scanners. The
    rule names MUST stay in sync with the builtin rule table in
    app/services/yara_scan_service.py — severity/description meta is resolved
    from that table when parsing CLI output.

    Note: php_in_image and htaccess_auto_prepend are contextual (they depend
    on the *filename*), which plain YARA cannot express; their matches are
    post-filtered by file extension/name in YaraScanService for both the CLI
    and the fallback engine.
*/

rule php_eval_base64
{
    meta:
        name = "php_eval_base64"
        severity = "critical"
        description = "eval() of base64-decoded payload (classic obfuscated backdoor loader)"
    strings:
        $a = /eval\s*\(\s*@?\s*base64_[d]ecode\s*\(/ nocase
    condition:
        $a
}

rule php_gzinflate_base64
{
    meta:
        name = "php_gzinflate_base64"
        severity = "critical"
        description = "gzinflate(base64_decode(...)) double-obfuscated payload"
    strings:
        $a = /gzinflate\s*\(\s*@?\s*base64_[d]ecode\s*\(/ nocase
    condition:
        $a
}

rule php_gzuncompress_base64
{
    meta:
        name = "php_gzuncompress_base64"
        severity = "critical"
        description = "gzuncompress/str_rot13 of base64-decoded payload"
    strings:
        $a = /(gzuncompress|str_rot13)\s*\(\s*@?\s*base64_[d]ecode\s*\(/ nocase
    condition:
        $a
}

rule preg_replace_e_eval
{
    meta:
        name = "preg_replace_e_eval"
        severity = "critical"
        description = "preg_replace() with the /e modifier (evaluates the replacement as PHP)"
    strings:
        $a = /preg_replace\s*\(\s*["'][^"']{0,60}\/[imsxu]{0,4}e[imsxu]{0,4}["']\s*,/ nocase
    condition:
        $a
}

rule assert_request_input
{
    meta:
        name = "assert_request_input"
        severity = "critical"
        description = "assert() fed directly from request input (code execution primitive)"
    strings:
        $a = /assert\s*\(\s*@?\s*\$_(REQUEST|GET|POST|COOKIE)\b/ nocase
    condition:
        $a
}

rule system_request_input
{
    meta:
        name = "system_request_input"
        severity = "critical"
        description = "system() executing raw request input"
    strings:
        $a = /system\s*\(\s*@?\s*\$_(REQUEST|GET|POST|COOKIE)\b/ nocase
    condition:
        $a
}

rule passthru_request_input
{
    meta:
        name = "passthru_request_input"
        severity = "critical"
        description = "passthru() executing raw request input"
    strings:
        $a = /passthru\s*\(\s*@?\s*\$_(REQUEST|GET|POST|COOKIE)\b/ nocase
    condition:
        $a
}

rule shell_exec_request_input
{
    meta:
        name = "shell_exec_request_input"
        severity = "critical"
        description = "shell_exec() executing raw request input"
    strings:
        $a = /shell_exec\s*\(\s*@?\s*\$_(REQUEST|GET|POST|COOKIE)\b/ nocase
    condition:
        $a
}

rule eval_request_input
{
    meta:
        name = "eval_request_input"
        severity = "critical"
        description = "eval() fed directly from request input"
    strings:
        $a = /eval\s*\(\s*@?\s*\$_(REQUEST|GET|POST|COOKIE)\b/ nocase
    condition:
        $a
}

rule upload_chmod_777_combo
{
    meta:
        name = "upload_chmod_777_combo"
        severity = "high"
        description = "move_uploaded_file combined with chmod 777 in the same file (dropper pattern)"
    strings:
        $a = /move_uploaded_file\s*\(/ nocase
        $b = /chmod\s*\([^)]{0,120}0?777/ nocase
    condition:
        $a and $b
}

rule c99_shell_marker
{
    meta:
        name = "c99_shell_marker"
        severity = "critical"
        description = "c99 web shell family marker"
    strings:
        $a = /c99(sh(ell)?|_launcher|madshell)/ nocase
    condition:
        $a
}

rule r57_shell_marker
{
    meta:
        name = "r57_shell_marker"
        severity = "critical"
        description = "r57 web shell family marker"
    strings:
        $a = /r57(shell|_tricks|\s+shell)/ nocase
    condition:
        $a
}

rule wso_shell_marker
{
    meta:
        name = "wso_shell_marker"
        severity = "critical"
        description = "WSO (web shell by orb) family marker"
    strings:
        $a = /(wso_version|wsoshell|wso\s*2\.[0-9]|\$wso\b)/ nocase
    condition:
        $a
}

rule filesman_marker
{
    meta:
        name = "filesman_marker"
        severity = "critical"
        description = "FilesMan backdoor file-manager marker"
    strings:
        $a = /Files[M]an/
    condition:
        $a
}

rule php_in_image
{
    meta:
        name = "php_in_image"
        severity = "high"
        description = "PHP open tag inside an image file (.ico/.jpg/.png/...) - mismatched extension dropper"
    strings:
        $a = /<\?php/ nocase
    condition:
        $a
}

rule htaccess_auto_prepend
{
    meta:
        name = "htaccess_auto_prepend"
        severity = "high"
        description = "auto_prepend_file injection via .htaccess/.user.ini (loads a payload before every request)"
    strings:
        $a = /auto_prepend_[f]ile/ nocase
    condition:
        $a
}
