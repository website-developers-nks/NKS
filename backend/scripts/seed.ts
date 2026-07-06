import 'dotenv/config';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { User } from '../src/db/models/user.model';
import { OnboardingAuth } from '../src/db/models/onboarding-auth.model';

async function seed() {
  await mongoose.connect("process.env.MONGODB_URI!");
  console.log('Connected to MongoDB');

  const user = await User.create({
    email: 'demo@nksecurities.com',
    firstName: 'Demo',
    lastName: 'User',
  });

  const onboardingKey = randomUUID();

  const auth = await OnboardingAuth.create({
    onboardingKey,
    user: user._id,
    ttl: 3600,
  });

  console.log('User created:');
  console.log(`  id    : ${user._id}`);
  console.log(`  email : ${user.email}`);
  console.log('\nOnboardingAuth created:');
  console.log(`  id             : ${auth._id}`);
  console.log(`  onboardingKey  : ${auth.onboardingKey}`);
  console.log(`  authKey        : (unset)`);
  console.log(`  lastVerified   : (unset)`);
  console.log(`  ttl            : ${auth.ttl}s`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
