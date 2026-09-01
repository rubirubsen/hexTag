-- =========================================================
-- hexTag - Microsoft SQL Server (MSSQL) Schema & Migration
-- =========================================================

-- 1. Users Table (Spielerprofile & SSO)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' AND xtype='U')
BEGIN
    CREATE TABLE Users (
        id NVARCHAR(64) PRIMARY KEY,
        username NVARCHAR(64) NOT NULL,
        email NVARCHAR(128) NULL,
        avatar_url NVARCHAR(512) NULL,
        password_hash NVARCHAR(256) NULL,
        sso_provider NVARCHAR(32) NOT NULL DEFAULT 'guest',
        sso_id NVARCHAR(128) NOT NULL,
        color NVARCHAR(16) NOT NULL DEFAULT '#ff8000',
        xp INT NOT NULL DEFAULT 0,
        level INT NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL,
        last_login BIGINT NOT NULL
    );
    CREATE NONCLUSTERED INDEX IX_Users_SSO ON Users(sso_provider, sso_id);
    PRINT 'Tabelle [Users] erfolgreich erstellt.';
END
ELSE
BEGIN
    IF NOT EXISTS (SELECT * FROM syscolumns WHERE id=OBJECT_ID('Users') AND name='password_hash')
    BEGIN
        ALTER TABLE Users ADD password_hash NVARCHAR(256) NULL;
        PRINT 'Spalte [password_hash] zu Users hinzugefügt.';
    END
END
GO

-- 2. HexZones Table (Waben-Territorien & King of the Hill)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='HexZones' AND xtype='U')
BEGIN
    CREATE TABLE HexZones (
        hex_id NVARCHAR(32) PRIMARY KEY,
        owner_id NVARCHAR(64) NULL,
        owner_name NVARCHAR(64) NOT NULL DEFAULT 'Unbekannt',
        color NVARCHAR(16) NOT NULL DEFAULT '#ff8000',
        captured_at BIGINT NOT NULL,
        total_held_seconds INT NOT NULL DEFAULT 0,
        capture_count INT NOT NULL DEFAULT 1,
        is_contested BIT NOT NULL DEFAULT 0
    );
    CREATE NONCLUSTERED INDEX IX_HexZones_Owner ON HexZones(owner_id);
    PRINT 'Tabelle [HexZones] erfolgreich erstellt.';
END
GO

-- 3. GraffitiTags Table (AR Kunstwerke & Tags)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='GraffitiTags' AND xtype='U')
BEGIN
    CREATE TABLE GraffitiTags (
        id NVARCHAR(64) PRIMARY KEY,
        hex_id NVARCHAR(32) NOT NULL,
        user_id NVARCHAR(64) NULL,
        author NVARCHAR(64) NOT NULL,
        color NVARCHAR(16) NOT NULL DEFAULT '#ff8000',
        lat FLOAT NOT NULL,
        lng FLOAT NOT NULL,
        image_data NVARCHAR(MAX) NOT NULL,
        tag_type NVARCHAR(16) NOT NULL DEFAULT 'draw',
        created_at BIGINT NOT NULL
    );
    CREATE NONCLUSTERED INDEX IX_GraffitiTags_Hex ON GraffitiTags(hex_id);
    CREATE NONCLUSTERED INDEX IX_GraffitiTags_Created ON GraffitiTags(created_at DESC);
    PRINT 'Tabelle [GraffitiTags] erfolgreich erstellt.';
END
GO

-- 4. PlayerHQs Table (Desktop Stützpunkte)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PlayerHQs' AND xtype='U')
BEGIN
    CREATE TABLE PlayerHQs (
        id NVARCHAR(64) PRIMARY KEY,
        user_id NVARCHAR(64) NOT NULL,
        hex_id NVARCHAR(32) NOT NULL,
        lat FLOAT NOT NULL,
        lng FLOAT NOT NULL,
        name NVARCHAR(64) NOT NULL DEFAULT 'STÜTZPUNKT ALPHA',
        color NVARCHAR(16) NOT NULL DEFAULT '#ff8000',
        created_at BIGINT NOT NULL
    );
    CREATE NONCLUSTERED INDEX IX_PlayerHQs_User ON PlayerHQs(user_id);
    PRINT 'Tabelle [PlayerHQs] erfolgreich erstellt.';
END
GO

-- 5. ActiveDrones Table (Aktive Dronen-Missionen)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ActiveDrones' AND xtype='U')
BEGIN
    CREATE TABLE ActiveDrones (
        id NVARCHAR(64) PRIMARY KEY,
        user_id NVARCHAR(64) NOT NULL,
        target_hex_id NVARCHAR(32) NOT NULL,
        color NVARCHAR(16) NOT NULL DEFAULT '#ff8000',
        duration_seconds INT NOT NULL DEFAULT 90,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL
    );
    PRINT 'Tabelle [ActiveDrones] erfolgreich erstellt.';
END
GO

-- =========================================================
-- INITIAL SEED DATA (Start-Datensatz fuer Demo & Test)
-- =========================================================

-- Test User
IF NOT EXISTS (SELECT 1 FROM Users WHERE id = 'u_system_admin')
BEGIN
    INSERT INTO Users (id, username, email, avatar_url, sso_provider, sso_id, color, xp, level, created_at, last_login)
    VALUES ('u_system_admin', 'Cyber_Overlord', 'admin@hextag.app', 'https://api.dicebear.com/7.x/bottts/svg?seed=Cyber_Overlord', 'system', 'admin_01', '#ff8000', 500, 5, 1725148800000, 1725148800000);
    PRINT 'Seed User [Cyber_Overlord] angelegt.';
END

-- Test Hex Zone (Alexanderplatz Berlin)
IF NOT EXISTS (SELECT 1 FROM HexZones WHERE hex_id = '8a1f1d488777fff')
BEGIN
    INSERT INTO HexZones (hex_id, owner_id, owner_name, color, captured_at, total_held_seconds, capture_count, is_contested)
    VALUES ('8a1f1d488777fff', 'u_system_admin', 'Cyber_Overlord', '#ff8000', 1725148800000, 7200, 1, 0);
    PRINT 'Seed HexZone angelegt.';
END
GO
