import pathlib

edits = {
    'api/src/routes/auth.js': [
        ("roleId: roleIds['Owner/Admin'],", "roleId: roleIds['Dono/Admin'],"),
    ],
    'api/src/routes/google.js': [
        ("roleId: roleIds['Owner/Admin'],", "roleId: roleIds['Dono/Admin'],"),
    ],
    'api/src/routes/platform.js': [
        ("role.name === 'Owner/Admin'", "role.name === 'Dono/Admin'"),
        ("member.roleName === 'Owner/Admin'", "member.roleName === 'Dono/Admin'"),
        ("(nextRole && nextRole.name !== 'Owner/Admin')", "(nextRole && nextRole.name !== 'Dono/Admin')"),
        ("eq(roles.name, 'Owner/Admin')", "eq(roles.name, 'Dono/Admin')"),
        ("The final active Owner/Admin cannot be deactivated or reassigned",
         "O último Dono/Admin ativo não pode ser desativado ou reatribuído"),
    ],
}

for p, es in edits.items():
    f = pathlib.Path(p)
    t = f.read_text()
    for a, b in es:
        if a in t:
            t = t.replace(a, b)
        else:
            print(f'AVISO: não achado: {p} :: {a}')
    f.write_text(t)
    print(p, 'ok')
