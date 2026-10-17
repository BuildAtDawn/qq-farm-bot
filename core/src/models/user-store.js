const DEFAULT_ACCOUNT_LIMIT = Number.MAX_SAFE_INTEGER;

function getAllUsers() {
  return [{
    username: "admin",
    role: "admin",
    card: null,
    accountLimit: DEFAULT_ACCOUNT_LIMIT,
  }];
}

module.exports = {
  DEFAULT_ACCOUNT_LIMIT,
  getAllUsers,
};
