<#
.SYNOPSIS
Generates SQL to reset a RAFACSIMS password in D1.
.DESCRIPTION
Paste the generated SQL line into the target D1 console and select Execute.
Pass -Copy to copy the entire line to the Windows clipboard.
#>

param([switch]$Copy)

$ErrorActionPreference = 'Stop'

$username = (Read-Host 'Staff username').Trim()
if ($username -notmatch '\A[a-zA-Z0-9_.-]{2,40}\z') {
    throw 'Enter a valid RAFACSIMS username.'
}

$secret = Read-Host "New temporary password for $username" -AsSecureString
try {
    if ($secret.Length -lt 6 -or $secret.Length -gt 128) {
        throw 'The password must be 6 to 128 characters.'
    }

    $saltBytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($saltBytes)
    } finally {
        $rng.Dispose()
    }

    $salt = [BitConverter]::ToString($saltBytes).Replace('-', '').ToLowerInvariant()
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        # The Worker derives the key from the UTF-8 text of the hex salt.
        $key = [Security.Cryptography.Rfc2898DeriveBytes]::new(
            $password, [Text.Encoding]::UTF8.GetBytes($salt), 100000,
            [Security.Cryptography.HashAlgorithmName]::SHA256
        )
        try {
            $hash = [BitConverter]::ToString($key.GetBytes(32)).Replace('-', '').ToLowerInvariant()
            $storedHash = 'pbkdf2$100000${0}${1}' -f $salt, $hash
        } finally {
            $key.Dispose()
        }
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
} finally {
    $secret.Dispose()
}

# If a later reset replaces this hash, leave its sessions alone.
$sql = @"
UPDATE staff
SET password_hash = '$storedHash',
    must_change_password = 1
WHERE username = '$username'
RETURNING username, role, must_change_password;

DELETE FROM sessions
WHERE user_id = (
    SELECT id FROM staff
    WHERE username = '$username'
      AND password_hash = '$storedHash'
);

WITH reset_result AS (
    SELECT COALESCE(staff.username, requested.username) AS username,
           staff.id AS account_id,
           staff.must_change_password,
           staff.password_hash = '$storedHash' AS hash_matches,
           (SELECT COUNT(*) FROM sessions WHERE user_id = staff.id) AS sessions_remaining
    FROM (SELECT '$username' AS username) AS requested
    LEFT JOIN staff ON staff.username = requested.username
)
SELECT username,
       CASE
           WHEN account_id IS NULL THEN 'Account not found'
           WHEN hash_matches IS NOT 1 THEN 'This reset password is not current'
           WHEN must_change_password IS NOT 1 THEN 'Password change flag is not set'
           WHEN sessions_remaining > 0 THEN 'Password updated. Sessions remain.'
           ELSE 'Password reset complete'
       END AS status,
       must_change_password,
       CASE WHEN account_id IS NOT NULL THEN sessions_remaining END AS sessions_remaining
FROM reset_result;
"@

$command = ($sql -replace '\r?\n\s*', ' ').Trim()
if ($Copy) {
    Set-Clipboard -Value $command
    Write-Host 'Complete SQL command copied. Paste it into the D1 Console and select Execute.'
}
$command
