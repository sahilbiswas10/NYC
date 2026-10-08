# First administrator setup

The application does not ship with a default administrator password. To create the first admin, set a unique email and a password of at least 12 characters in the shell, then run:

```sh
export INITIAL_ADMIN_EMAIL='admin@example.com'
read -s INITIAL_ADMIN_PASSWORD
export INITIAL_ADMIN_PASSWORD
npm run admin:bootstrap
unset INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD
```

The command uses `MONGO_URI` from the environment or `.env`. It only creates an admin when none exists and never promotes or changes an existing account. It does not print the password. After it succeeds, sign in through `/login.html` with the email and password you supplied.
